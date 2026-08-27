/**
 * 增强 bash 工具 — 前台委托 Pi 原生实现,新增 background: true 后台执行
 *
 * 前台分支:直接调 createBashToolDefinition(cwd) 的原生 execute,
 * 行为零改动(同步执行 + tool_execution_update 实时流式输出)。
 * 后台分支:spawn 子进程注册到 BackgroundShellRegistry,立即返回
 * 「已后台启动」,不阻塞回合——对齐 Claude Code run_in_background。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getCreateBashToolDefinition } from "../pi-sdk";
import { backgroundShellRegistry, type BackgroundShell } from "./registry";
import { resolveSpawn } from "./registry";
import { spawn } from "node:child_process";
import { createCodingAwareDecoder, stripAnsi } from "./encoding";

/** 前台 bash 执行(spawn + 编码容错解码,对齐 Pi 行为:同步 + 超时 + 截断提示 + PI_* 环境注入) */
async function executeForeground(
  command: string,
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutSec?: number,
  ctx?: { model?: { provider?: string; id?: string }; thinkingLevel?: string; sessionManager?: { getSessionId(): string; getSessionFile?(): string } },
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return new Promise((resolve, reject) => {
    const { file, args, opts, error } = resolveSpawn(command, cwd);
    if (error) {
      resolve({ content: [{ type: "text", text: error }] });
      return;
    }
    // 注入 PI_* 环境变量(对齐 Pi resolveSpawnContext):脚本可读当前会话/模型信息
    if (ctx && opts.env === undefined) {
      const env: Record<string, string> = { ...process.env as Record<string, string> };
      try {
        if (ctx.sessionManager) {
          env.PI_SESSION_ID = ctx.sessionManager.getSessionId();
          const sf = ctx.sessionManager.getSessionFile?.();
          if (sf) env.PI_SESSION_FILE = sf;
        }
        if (ctx.model) {
          if (ctx.model.provider) env.PI_PROVIDER = ctx.model.provider;
          if (ctx.model.id) env.PI_MODEL = ctx.model.id;
        }
        if (ctx.thinkingLevel) env.PI_REASONING_LEVEL = ctx.thinkingLevel;
      } catch { /* 会话信息不可用时跳过注入 */ }
      (opts as { env?: Record<string, string> }).env = env;
    }
    const child = spawn(file, args, opts);
    const outDec = createCodingAwareDecoder();
    const errDec = createCodingAwareDecoder();
    let output = "";
    let errOutput = "";
    let timedOut = false;
    const timer = timeoutSec
      ? setTimeout(() => {
          timedOut = true;
          killTree();
        }, timeoutSec * 1000)
      : null;
    const killTree = () => {
      try {
        if (process.platform === "win32" && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
        } else if (child.pid) {
          process.kill(-child.pid, "SIGKILL");
        }
      } catch { child.kill(); }
    };
    // 前台 bash:解码后剥 ANSI,返回给 Mint 的文本干净(彩色输出只含控制码,剥离无信息损失)
    child.stdout?.on("data", (c: Buffer) => { output += stripAnsi(outDec.feed(c)); });
    child.stderr?.on("data", (c: Buffer) => { errOutput += stripAnsi(errDec.feed(c)); });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`bash 执行失败: ${err.message}`));
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      output += stripAnsi(outDec.finish());
      errOutput += stripAnsi(errDec.finish());
      const text = [output, errOutput].filter(Boolean).join("\n") || "(无输出)";
      if (timedOut) {
        resolve({ content: [{ type: "text", text: `${text}\n\n(命令超时,已终止)` }] });
        return;
      }
      // 输出截断提示(对齐 Pi:超过 8KB 仅显示尾部)
      if (Buffer.byteLength(text, "utf-8") > 8192) {
        const tail = text.slice(-6000);
        resolve({ content: [{ type: "text", text: `${tail}\n\n[输出过长,仅显示尾部。完整输出见日志]` }] });
        return;
      }
      resolve({ content: [{ type: "text", text: code === 0 ? text : `${text}\n\n(退出码: ${code})` }] });
    });
    if (signal) {
      if (signal.aborted) killTree();
      else signal.addEventListener("abort", killTree, { once: true });
    }
  });
}

export interface EnhancedBashOptions {
  /** 进程退出回调(agent-service 注入结果到主会话;缺省仅后台跑不通知) */
  onExit?: (shell: BackgroundShell) => void;
}

/** 输出尾部预览行数(通知精简:完整输出落盘,会话内只带尾部几行) */
const PREVIEW_TAIL_LINES = 10;

/** 后台命令退出 → 注入主会话的文本(⏺ 摘要行对齐委派通知渲染,前端按状态着色)。
    stopped = 用户/Mint 主动停止——明确「已由用户中断」,避免 Mint 误判为意外失败自动重启 */
export function formatShellResult(shell: BackgroundShell): string {
  const status = shell.stopped ? "已由用户中断" : (shell.exitCode === 0 ? "完成" : "失败");
  const dur = Math.max(0, Math.round((Date.now() - shell.startedAt) / 1000));
  const summary = `⏺ 后台命令 — ${status}${dur > 0 ? ` · ${dur}s` : ""}`;
  const head = `命令: ${shell.command}\n退出码: ${shell.exitCode ?? "?"}`;
  const tail = shell.output.trim().split("\n").slice(-PREVIEW_TAIL_LINES).join("\n").trim();
  const output = tail
    ? `输出(尾部 ${PREVIEW_TAIL_LINES} 行):\n${tail}`
    : "(无输出)";
  const logHint = `完整输出: ${shell.logPath}`;
  return `${summary}\n${head}\n${output}\n${logHint}`;
}

export async function createEnhancedBashTool(
  cwd: string,
  options?: EnhancedBashOptions,
): Promise<ToolDefinition> {
  const createBashToolDefinition = await getCreateBashToolDefinition();
  const native = createBashToolDefinition(cwd);

  return {
    name: "bash",
    label: "bash",
    description:
      "Execute a bash command in the current working directory. Returns stdout and stderr. "
      + "For long-running or service commands (dev server, watchers, background jobs), "
      + "pass background: true to run in the background without blocking the conversation — "
      + "the result will be injected back when the command exits. "
      + "后台命令的 stdout/stderr 会被自动收集:输出面板实时显示、完整输出落盘日志文件、退出后结果自动注入会话。"
      + "禁止在命令中手动重定向输出(如 `> file 2>&1`、`| tee`、`nohup ... &`)——重定向会绕过自动收集,"
      + "输出面板和退出通知将无内容;需要读完整输出时,用 read 工具读系统返回的日志文件路径。",
    promptSnippet: "执行 bash 命令(前台同步/后台长驻;后台输出自动收集,勿手动重定向)",
    promptGuidelines: [
      ...(Array.isArray(native.promptGuidelines) ? native.promptGuidelines : []),
      "后台命令(background: true)的输出会被系统自动收集并落盘——不要在命令里手动重定向 `> file 2>&1` 或 `| tee`(会绕过自动收集,面板和退出通知无输出)",
      "后台命令返回的输出文件路径(logPath)可直接用 read 工具读取完整输出",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        command: { type: "string" as const, description: "要执行的命令" },
        timeout: { type: "number" as const, description: "超时秒数(前台模式)" },
        background: {
          type: "boolean" as const,
          description: "true 时后台执行:立即返回,命令在后台运行,退出后结果注入会话",
        },
      },
      required: ["command"],
    },
    async execute(
      _toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      _onUpdate: any,
      ctx: any,
    ) {
      const command = String(params.command || "");
      if (!command) {
        return { content: [{ type: "text" as const, text: "请提供 command" }] };
      }

      // 前台:EM 自己 spawn + 编码容错解码(Windows 下 Pi 的 OutputAccumulator 固定 UTF-8,
      // 解 GBK 字节必乱码;EM 侧按 UTF-8/GBK 自动判定)。行为对齐 Pi:同步 + 超时 + 截断 + PI_* 注入。
      if (params.background !== true) {
        return executeForeground(command, cwd, signal, typeof params.timeout === "number" ? params.timeout : undefined, ctx);
      }

      // 后台:spawn + 注册,立即返回
      // 返回信息带输出文件路径(对齐 cc run_in_background)——模型从启动时就知道
      // 去哪读输出,运行中可随时 read,不必等退出通知
      let shellSessionId: string | undefined;
      try { shellSessionId = ctx?.sessionManager?.getSessionId?.(); } catch { /* 会话信息不可用 */ }
      const { id, logPath } = backgroundShellRegistry.start(command, cwd, options?.onExit, shellSessionId);
      return {
        content: [{
          type: "text" as const,
          text: `已后台启动: ${command}\n后台 ID: ${id}\n输出自动收集(面板实时显示),完整输出落盘: ${logPath}\n命令退出后结果将自动注入会话。无需在命令中手动重定向输出——手动重定向会绕过自动收集,面板和通知将无内容。`,
        }],
      };
    },
  } as unknown as ToolDefinition;
}
