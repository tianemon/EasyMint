/**
 * 增强 bash 工具 — 前台 EM 自 spawn(Windows 下 GBK 解码容错),新增 background: true 后台执行
 *
 * 前台分支:同步执行 + 超时 + 截断 + PI_* 注入;执行中经 SDK 的 onUpdate 推增量输出
 * (tool_execution_update → 前端命令展开区实时显示)。
 * 后台分支:spawn 子进程注册到 BackgroundShellRegistry,立即返回
 * 「已后台启动」,不阻塞回合——对齐 Claude Code run_in_background。
 */

import type { ToolDefinition } from "../pi-sdk";
import { getCreateBashToolDefinition } from "../pi-sdk";
import { backgroundShellRegistry, type BackgroundShell, resolveSpawn, findBashOnWindows } from "./registry";
import { spawn } from "node:child_process";
import { createCodingAwareDecoder, createAnsiStripper, stripAnsi } from "./encoding";
import { ensureSandbox, wrapForSandbox, annotateSandboxFailures } from "../sandbox/manager";
import { maskSecrets } from "../../utils/secret-mask";

/** 前台 bash 执行(spawn + 编码容错解码,对齐 Pi 行为:同步 + 超时 + 截断提示 + PI_* 环境注入)
 *  command: shell 命令字符串（走 resolveSpawn）或沙盒 argv 规格（Windows srt-win 两跳, shell:false + env 注入）
 *  sandboxed: 命令已沙盒包装(权限层判不了域放行),退出时把违规拦截注解进 stderr(大白话违规说明) */
async function executeForeground(
  command: string | { argv: string[]; env: NodeJS.ProcessEnv },
  cwd: string,
  signal: AbortSignal | undefined,
  timeoutSec?: number,
  ctx?: { model?: { provider?: string; id?: string }; thinkingLevel?: string; sessionManager?: { getSessionId(): string; getSessionFile?(): string } },
  sandboxed?: boolean,
  /** SDK 增量回调:执行中把输出片段推给 UI(无则跳过,后台/无 UI 场景不受影响) */
  onUpdate?: (partial: { content: Array<{ type: string; text: string }> }) => void,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  return new Promise((resolve, reject) => {
    const spawnPlan = typeof command === "string"
      ? resolveSpawn(command, cwd)
      : { file: command.argv[0] ?? "", args: command.argv.slice(1), opts: { cwd, env: command.env }, error: undefined };
    const { file, args, opts, error } = spawnPlan;
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
    // 前台 bash:解码后流式剥 ANSI,返回给 Mint 的文本干净(彩色输出只含控制码,剥离无信息损失)
    const outAnsi = createAnsiStripper();
    const errAnsi = createAnsiStripper();
    // 实时输出节流推送:逐 chunk 推会让 UI 高频重渲染,合并 150ms 内的片段再发。
    // 推增量而非累积全文——长输出下不必每帧搬运全部内容。
    // 不脱敏:只用于用户本机 UI 展示(不进模型上下文),增量切片也会破坏密钥匹配的完整性
    let pendingDelta = "";
    let deltaTimer: ReturnType<typeof setTimeout> | null = null;
    const flushDelta = (): void => {
      if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
      if (!onUpdate || !pendingDelta) return;
      onUpdate({ content: [{ type: "text", text: pendingDelta }] });
      pendingDelta = "";
    };
    const emitDelta = (chunk: string): void => {
      if (!onUpdate || !chunk) return;
      pendingDelta += chunk;
      if (!deltaTimer) deltaTimer = setTimeout(flushDelta, 150);
    };
    child.stdout?.on("data", (c: Buffer) => { const s = outAnsi.feed(outDec.feed(c)); output += s; emitDelta(s); });
    child.stderr?.on("data", (c: Buffer) => { const s = errAnsi.feed(errDec.feed(c)); errOutput += s; emitDelta(s); });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      flushDelta();
      reject(new Error(`bash 执行失败: ${err.message}`));
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      flushDelta();
      output += outAnsi.feed(outDec.finish()) + outAnsi.finish();
      errOutput += errAnsi.feed(errDec.finish()) + errAnsi.finish();
      // 沙盒违规注解：seatbelt/代理产生的拦截在此转成可读说明（仅沙盒执行时）。
      // argv 形态（Windows srt-win 两跳）的违规归因 key 形态不同——留待 Windows 实机验证
      if (sandboxed && typeof command === "string") errOutput = annotateSandboxFailures(command, errOutput);
      // 凭据脱敏：agent 若违规内联密码/连接串，明文不进模型可见的输出
      const text = maskSecrets([output, errOutput].filter(Boolean).join("\n") || "(无输出)");
      if (timedOut) {
        resolve({ content: [{ type: "text", text: `${text}\n\n(命令超时,已中止)` }] });
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
 *  stopped = 用户/Mint 主动停止——按停止来源区分文案(用户 UI→已由用户中止;Mint→已中止),
 *  两者都明确是主动停止,避免 Mint 误判为意外失败自动重启 */
export function formatShellResult(shell: BackgroundShell): string {
  const status = shell.stopped
    ? (shell.stoppedBy === "mint" ? "已中止" : "已由用户中止")
    : (shell.exitCode === 0 ? "完成" : "失败");
  const dur = Math.max(0, Math.round((Date.now() - shell.startedAt) / 1000));
  const summary = `⏺ 后台命令 - ${status}${dur > 0 ? ` · ${dur}s` : ""}`;
  const head = `命令: ${shell.command}\n退出码: ${shell.exitCode ?? "?"}`;
  // 注入主会话文本剥 ANSI + 凭据脱敏(shell.output 保留原始供面板彩色渲染;模型/消息区要干净文本)
  const tail = maskSecrets(stripAnsi(shell.output.trim().split("\n").slice(-PREVIEW_TAIL_LINES).join("\n").trim()));
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
      + "输出面板和退出通知将无内容;需要读完整输出时,用 read 工具读系统返回的日志文件路径。"
      + "每次调用都要填 description:一句话中文简述这次命令在做什么(如「查找文件」「提交 git」「推送代码」「安装依赖」),"
      + "用于聊天页展示给用户看。",
    promptSnippet: "执行 bash 命令(前台同步/后台长驻;后台输出自动收集,勿手动重定向)",
    promptGuidelines: [
      ...(Array.isArray(native.promptGuidelines) ? native.promptGuidelines : []),
      "后台命令(background: true)的输出会被系统自动收集并落盘——不要在命令里手动重定向 `> file 2>&1` 或 `| tee`(会绕过自动收集,面板和退出通知无输出)",
      "后台命令返回的输出文件路径(logPath)可直接用 read 工具读取完整输出",
      "事件等待：需要等某事件/任务完成才能继续(CI 构建、服务就绪、下载、长任务收尾等)时，命令里必须实际等待——用 sleep 轮询/条件循环/gh run watch 等，前后台均可、优先前台(配足 timeout，命令返回即拿到结果继续)；长时间等待(约 >60s)用后台 watch/sleep，退出自动注入通知。禁止只承诺「等完成再汇报」却不挂任何等待命令——没有命令退出事件就没有主动唤醒，承诺无法兑现",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        command: { type: "string" as const, description: "要执行的命令" },
        description: {
          type: "string" as const,
          description: "一句话中文简述本次命令在做什么(≤12 字,如「查找文件」「提交 git」「推送代码」「安装依赖」),用于聊天页展示",
        },
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
      onUpdate: ((partial: { content: Array<{ type: string; text: string }> }) => void) | undefined,
      ctx: any,
    ) {
      const command = String(params.command || "");
      if (!command) {
        return { content: [{ type: "text" as const, text: "请提供 command" }] };
      }

      // 沙盒标记(权限层「判不了域」放行时经 updatedInput 注入):wrapWithSandbox 后执行。
      // 显示/通知用原命令;实际 spawn 用包装命令(含代理 env 前缀)。wrap 失败 = 明确报错(fail-closed)。
      const sandboxed = params.sandbox === true;
      let execTarget: string | { argv: string[]; env: NodeJS.ProcessEnv } = command;
      if (sandboxed) {
        const init = await ensureSandbox(cwd);
        if (!init.ok) {
          return { content: [{ type: "text" as const, text: `沙盒初始化失败：${init.reason}——请切换「完全访问」或检查沙盒依赖` }] };
        }
        try {
          // Windows 沙盒需要 Git Bash 绝对路径（srt argv 两跳启动的 binShell）
          const spec = await wrapForSandbox(command, process.platform === "win32" ? { gitBashPath: findBashOnWindows() ?? undefined } : undefined);
          execTarget = spec.kind === "argv" ? { argv: spec.argv, env: spec.env } : spec.command;
        } catch (e) {
          return { content: [{ type: "text" as const, text: `沙盒包装失败：${(e as Error).message}` }] };
        }
      }

      // 前台:EM 自己 spawn + 编码容错解码(Windows 下 Pi 的 OutputAccumulator 固定 UTF-8,
      // 解 GBK 字节必乱码;EM 侧按 UTF-8/GBK 自动判定)。行为对齐 Pi:同步 + 超时 + 截断 + PI_* 注入。
      if (params.background !== true) {
        return executeForeground(execTarget, cwd, signal, typeof params.timeout === "number" ? params.timeout : undefined, ctx, sandboxed, onUpdate);
      }

      // 后台:spawn + 注册,立即返回
      // 返回信息带输出文件路径(对齐 cc run_in_background)——模型从启动时就知道
      // 去哪读输出,运行中可随时 read,不必等退出通知
      let shellSessionId: string | undefined;
      try { shellSessionId = ctx?.sessionManager?.getSessionId?.(); } catch { /* 会话信息不可用 */ }
      const { id, logPath } = backgroundShellRegistry.start(execTarget, cwd, options?.onExit, shellSessionId, sandboxed ? command : undefined);
      return {
        content: [{
          type: "text" as const,
          text: `已后台启动: ${command}\n后台 ID: ${id}\n输出自动收集(面板实时显示),完整输出落盘: ${logPath}\n命令退出后结果将自动注入会话。无需在命令中手动重定向输出——手动重定向会绕过自动收集,面板和通知将无内容。`,
        }],
      };
    },
  } as unknown as ToolDefinition;
}

/** 停止后台命令工具 —— Mint 主动停止自己启动的后台命令。
 *  与 stop_agent 对称：不传 id 停全部；来源记 mint → 退出通知文案显示「已中止」
 *  （区别于用户点 UI 按钮的「已由用户中止」）。绕过本工具直接 kill 进程会让 EM
 *  判定为意外退出（通知显示「失败」），故工具描述里明确要求走此入口。 */
export function createStopShellTool(): ToolDefinition {
  /** 命令摘要（列表与返回文本共用，单行 + 截断） */
  const summarize = (s: BackgroundShell): string => s.command.replace(/\s+/g, " ").slice(0, 60);
  return {
    name: "stop_shell",
    label: "停止后台命令",
    description:
      "停止当前会话正在运行的后台命令(bash 工具 background: true 启动的)。"
      + "指定 id 只停该条(后台 ID 由 bash 返回)；不传 id 则停止全部。"
      + "使用场景:① 命令跑偏/报错刷屏要中止 ② 服务、监听类命令不再需要 ③ 用户要求停下。",
    promptSnippet: "停止运行中的后台命令(可指定 id,缺省停全部)",
    promptGuidelines: [
      "后台命令方向不对、刷屏或用户要求停时用此工具，不要绕过它直接 kill 进程——kill 会让 EM 判定为意外失败(通知显示「失败」)",
      "不传 id 会停止全部后台命令；只想停某一条时传 bash 返回的后台 ID",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        id: { type: "string" as const, description: "可选:后台命令 ID(bash 工具返回)，不传则停止全部" },
        reason: { type: "string" as const, description: "可选:停止原因(便于记录)" },
      },
    },
    async execute(
      _tid: string,
      params: Record<string, unknown>,
      _signal?: AbortSignal,
      _onUpdate?: unknown,
      ctx?: any,
    ) {
      // 按发起会话过滤（对齐 stop_agent 的会话语义）：只停本会话启动的命令，
      // 避免跨会话误停（多窗口/多 tab 并行时各自的后台命令互不干扰）
      let sessionId: string | undefined;
      try { sessionId = ctx?.sessionManager?.getSessionId?.(); } catch { /* 会话信息不可用 */ }
      const mine = (): BackgroundShell[] => {
        const all = backgroundShellRegistry.list();
        return sessionId ? all.filter((s) => !s.sessionId || s.sessionId === sessionId) : all;
      };
      const reason = params.reason ? `(${String(params.reason)})` : "";
      if (params.id) {
        const id = String(params.id);
        const target = mine().find((s) => s.id === id);
        if (!target) {
          const running = mine();
          const hint = running.length > 0
            ? `当前运行中: ${running.map((s) => `${s.id}(${summarize(s)})`).join(", ")}`
            : "当前会话没有运行中的后台命令";
          return { content: [{ type: "text" as const, text: `后台命令 ${id} 未在运行中。${hint}` }] };
        }
        backgroundShellRegistry.stop(id, "mint");
        return { content: [{ type: "text" as const, text: `已停止后台命令 ${id}: ${summarize(target)}${reason}` }] };
      }
      const running = mine();
      if (running.length === 0) return { content: [{ type: "text" as const, text: "当前会话没有运行中的后台命令" }] };
      for (const s of running) backgroundShellRegistry.stop(s.id, "mint");
      const list = running.map((s) => `- ${s.id}: ${summarize(s)}`).join("\n");
      return { content: [{ type: "text" as const, text: `已停止 ${running.length} 个后台命令${reason}:\n${list}` }] };
    },
  } as unknown as ToolDefinition;
}
