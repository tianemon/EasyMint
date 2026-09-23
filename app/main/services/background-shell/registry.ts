/**
 * 后台 shell 注册表 — 管理 Mint 以 background: true 启动的长驻命令进程
 *
 * 对标 Claude Code 的 run_in_background:spawn 子进程后工具立即返回,
 * 进程由主进程侧托管。按 id(toolCallId)注册,支持停止(杀进程树)、
 * 输出收集(尾部截断 + 完整落盘)、会话清理。
 *
 * 通知/停止闭环(对齐 task 工具优化经验):
 * - 完整输出落盘 <cwd>/.easymint/shell-logs/<id>.log(保留 7 天自动清理),通知只带尾部预览。
 *   **可回看范围仅限本次运行**:registry 是内存态、启动不 rehydrate,前端 delegation-store
 *   也不持久化 logPath ⇒ 重启后旧日志在 UI 上不可达(2026-09-17 用户拍板:日志本就是临时的,
 *   不为此补 rehydrate;保留期只用于兜住"长期不重启"时的磁盘积累)
 * - stop() 立即置 stopping 并广播(前端即时反馈),5s 未退出 SIGKILL 兜底
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, type WriteStream } from "node:fs";
import path from "node:path";
import { broadcast } from "../ipc-broadcast";
import { decodeSeg, finalDecode } from "./encoding";
import { readManagedEnvironment } from "../tools/environment-tool";
import { annotateSandboxFailures } from "../sandbox/manager";
import { trackChild, untrackChild } from "../process-registry";
// 纯类型导入（编译后擦除，不产生运行时循环：tool.ts 运行时依赖本文件）
import type { ExecutionTarget } from "./tool";

/** 保留输出尾部上限(内存,通知预览;超出截断,防止内存膨胀) */
const MAX_OUTPUT_BYTES = 4096;
/** 完整输出落盘上限(超出停止写入,防止磁盘膨胀) */
const MAX_LOG_BYTES = 5 * 1024 * 1024;
/** 日志保留天数(启动命令时顺带清理更早的,防积累) */
const LOG_RETENTION_DAYS = 7;
/** stop 后未退出的强制击杀等待(ms) */
const FORCE_KILL_AFTER_MS = 5000;
/** 输出流广播节流间隔(dev server 逐字输出,合并 chunk 防 IPC 风暴;退出时强制 flush) */
const STREAM_THROTTLE_MS = 100;

/** 主动停止来源：用户 UI / Mint / 权限切换撤销。 */
export type ShellStopSource = "user" | "mint" | "revoke";

/** 前端 shell 列表数据(启动/停止/退出时广播 agent:shell-count) */
export interface ShellSummary {
  id: string;
  command: string;
  startedAt: number;
  status: "running" | "stopping";
  /** 完整输出日志文件路径(前端查看输出弹层定位) */
  logPath: string;
  /** 发起会话(前端按会话过滤:后台命令状态只显示在发起会话的 tab) */
  sessionId?: string;
}

export interface BackgroundShell {
  id: string;
  command: string;
  startedAt: number;
  child: ChildProcess;
  /** 发起会话(前端按会话过滤:后台命令状态只显示在发起会话的 tab) */
  sessionId?: string;
  /** 累积输出(内存尾部截断,通知预览) */
  output: string;
  /** 完整输出日志文件路径(通知携带,用户可自行查看) */
  logPath: string;
  /** 退出码(null = 尚未退出) */
  exitCode: number | null;
  /** 被 stop() 主动停止(true 时格式化结果标记「中止」,与自然失败区分) */
  stopped: boolean;
  /** 主动停止来源(stop() 记录;退出通知按真实来源生成文案) */
  stoppedBy?: ShellStopSource;
  /** 运行状态(running → stopping → 退出注销) */
  status: "running" | "stopping";
  /** 待广播的输出缓冲(100ms 节流合并,agent:shell-output) */
  streamBuf: string;
  /** 节流定时器(null = 无待刷) */
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** 进程退出回调(自然结束或被停止),exitCode 已写入 */
  onExit?: (shell: BackgroundShell) => void;
  /** Windows 沙盒 ACL worker 的命令租约；进程退出后才可安全撤销。 */
  releaseSandboxLease?: () => Promise<void>;
}

/** 清理超过保留期的日志文件(启动命令时顺带执行,轻量防积累) */
function cleanupOldLogs(logDir: string): void {
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 3600 * 1000;
    for (const f of readdirSync(logDir)) {
      if (!f.endsWith(".log")) continue;
      const p = path.join(logDir, f);
      try {
        if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true });
      } catch { /* 单个文件读取失败跳过 */ }
    }
  } catch { /* 目录不存在等,忽略 */ }
}

/**
 * Windows 解析 bash 可执行文件(对齐 Pi getShellConfig):
 * 1. ProgramFiles\Git\bin\bash.exe(64 位 Git)
 * 2. ProgramFiles(x86)\Git\bin\bash.exe(32 位 Git)
 * 3. PATH 上的 bash.exe(Cygwin/MSYS2/WSL)
 * 找不到返回 null(调用方回退 shell:true → cmd.exe)
 */
export function findBashOnWindows(): string | null {
  const candidates: string[] = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env["ProgramFiles(x86)"];
  if (pf) candidates.push(`${pf}\\Git\\bin\\bash.exe`);
  if (pf86) candidates.push(`${pf86}\\Git\\bin\\bash.exe`);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const r = spawnSync("where", ["bash.exe"], { encoding: "utf-8", timeout: 5000, windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const m = r.stdout.trim().split(/\r?\n/)[0];
      if (m && existsSync(m)) return m;
    }
  } catch { /* where 不可用等,忽略 */ }
  return null;
}

/** 统一生成受保护 bash 的平台参数，避免 Windows 调用方忘记传入已探测的 Git Bash。 */
export function sandboxGitBashPath(
  platform: NodeJS.Platform = process.platform,
  finder: () => string | null = findBashOnWindows,
): string | undefined {
  return platform === "win32" ? finder() ?? undefined : undefined;
}

/** 后台命令的 spawn 配置:Windows 用 Git Bash -c(对齐 Pi 工具,支持 cd /c/... 和管道 tail);
 *  Windows 无 Git Bash → 报错(错误信息进入工具结果,Mint 读到后自行调整策略);
 *  Unix 保持 shell:true(行为不变)。
 *  前台 bash(tool.ts)复用此配置。 */
export function resolveSpawn(command: string, cwd: string, environment?: NodeJS.ProcessEnv): { file: string; args: string[]; opts: Parameters<typeof spawn>[2]; error?: string } {
  const env = environment ?? { ...process.env, ...readManagedEnvironment() };
  if (process.platform === "win32") {
    const bash = findBashOnWindows();
    if (bash) {
      return {
        file: bash,
        args: ["-c", command],
        // Windows 不 detached(会导致 stdout/stderr 管道收不到数据);进程树清理走 taskkill /T
        // 注:LANG/LC_ALL 对 Windows 原生程序无效(编码由系统代码页决定),乱码由 encoding.ts 解码容错解决
        opts: { cwd, windowsHide: true, env },
      };
    }
    return {
      file: "cmd.exe",
      args: ["/c", "exit 1"],
      opts: { cwd, windowsHide: true },
      error: "需要 Git Bash 才能执行后台命令。请安装 Git for Windows(https://git-scm.com/download/win),或改用不含 Git Bash 语法的命令。",
    };
  }
  // Unix:shell:true + detached(独立进程组,kill(-pid) 杀树);此分支仅非 win32 可达
  return {
    file: command,
    args: [],
    opts: { shell: true, cwd, detached: true, env },
  };
}

class BackgroundShellRegistry {
  private shells = new Map<string, BackgroundShell>();

  /** 广播当前 shell 列表给前端(ShellBar 显示/展开) */
  private broadcastCount(): void {
    broadcast("agent:shell-count", this.list().map((s) => ({
      id: s.id, command: s.command, startedAt: s.startedAt, status: s.status, logPath: s.logPath,
      sessionId: s.sessionId,
    })));
  }

  /** 刷出该 shell 的节流缓冲到前端(定时触发/退出时强制触发) */
  private flushStream(shell: BackgroundShell): void {
    if (shell.flushTimer) { clearTimeout(shell.flushTimer); shell.flushTimer = null; }
    if (shell.streamBuf) {
      broadcast("agent:shell-output", { id: shell.id, chunk: shell.streamBuf, sessionId: shell.sessionId });
      shell.streamBuf = "";
    }
  }

  /** 启动后台命令,立即返回 id + 输出文件路径;进程退出时自动注销并回调 onExit。
   *  command = 实际执行内容（shell 字符串，或沙盒 argv 规格）；displayCommand = 面板/通知展示用（缺省 = 原命令） */
  start(
    command: ExecutionTarget,
    cwd: string,
    onExit?: (shell: BackgroundShell) => void,
    sessionId?: string,
    displayCommand?: string,
  ): { id: string; logPath: string } {
    const display = displayCommand ?? (typeof command === "string" ? command : "command" in command ? command.command : "(沙盒命令)");
    const id = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 完整输出落盘项目级 .easymint/shell-logs/(本次运行内可回看,跨重启不回看——见文件头注释);
    // 启动命令时顺带清理超过保留期的旧日志,防积累(清理策略见 cleanupOldLogs)
    const logDir = path.join(cwd, ".easymint", "shell-logs");
    const logPath = path.join(logDir, `${id}.log`);
    let logStream: WriteStream | null = null;
    let logBytes = 0;
    try {
      mkdirSync(logDir, { recursive: true });
      cleanupOldLogs(logDir);
      logStream = createWriteStream(logPath, { flags: "w" });
      // 日志是附属功能:外部目录写入失败降级为仅内存尾部,不中断命令
      logStream.on("error", (e) => console.warn(`[bg-shell] log write error ${id}:`, (e as Error).message));
    } catch (e) {
      console.warn(`[bg-shell] log open failed ${id}:`, (e as Error).message);
    }

    // Windows 用 Git Bash -c 执行(对齐 Pi 工具:支持 Git Bash 语法/cd /c/.../管道 tail);
    // Windows 无 Git Bash → 报错注入结果,不 spawn(错误信息让 Mint 读到后自行调整);
    // Unix 保持 shell:true + detached(独立进程组,kill(-pid) 杀树)
    // argv 规格（Windows 沙盒 srt-win 两跳）不走 resolveSpawn——直接 spawn(argv[0], rest, { shell:false, env })
    const spawnPlan = typeof command === "string"
      ? resolveSpawn(command, cwd)
      : "argv" in command
        ? { file: command.argv[0] ?? "", args: command.argv.slice(1), opts: { cwd, env: command.env }, error: undefined }
        : resolveSpawn(command.command, cwd, command.env);
    const { file, args, opts, error } = spawnPlan;
    if (error) {
      // 构造已失败 shell:输出=错误信息,立即走退出注销路径(结果注入主会话,Mint 读到后自行调整)
      logStream?.write(error);
      const shell: BackgroundShell = {
        id, command: display, startedAt: Date.now(), child: null as unknown as ChildProcess, output: error, logPath,
        exitCode: -1, stopped: false, status: "running", streamBuf: "", flushTimer: null, onExit,
        sessionId, releaseSandboxLease: typeof command === "string" ? undefined : command.release,
      };
      this.shells.set(id, shell);
      this.broadcastCount();
      console.warn(`[bg-shell] no bash on windows ${id}: ${error.slice(0, 80)}`);
      setTimeout(() => {
        if (this.shells.has(id)) {
          shell.exitCode = -1;
          this.shells.delete(id);
          logStream?.end();
          void shell.releaseSandboxLease?.();
          shell.onExit?.(shell);
          this.broadcastCount();
        }
      }, 0);
      return { id, logPath };
    }
    const child = spawn(file, args, opts);
    // shell 父进程退出后可能仍有组内子进程；登记表按进程组存活期保留它，退出清场才能找到。
    if ((opts as { detached?: boolean } | undefined)?.detached) trackChild(child, { detached: true });
    const shell: BackgroundShell = {
      id, command: display, startedAt: Date.now(), child, output: "", logPath,
      exitCode: null, stopped: false, status: "running", streamBuf: "", flushTimer: null, onExit,
      sessionId, releaseSandboxLease: typeof command === "string" ? undefined : command.release,
    };
    this.shells.set(id, shell);
    this.broadcastCount();

    // 编码容错:Git Bash 自身输出 UTF-8,但其调用的原生程序按系统代码页(GBK)输出——
    // 单用 UTF-8 解 GBK 字节必乱码。缓冲原始字节,整段解码 UTF-8 优先,含 replacement char(�)切 GBK。
    // (decodeSeg/finalDecode 见 encoding.ts 共享模块,前台 bash 同用)
    const outBuf = { bytes: Buffer.alloc(0) };
    const errBuf = { bytes: Buffer.alloc(0) };
    const collect = (chunk: Buffer, holder: { bytes: Buffer }): void => {
      // 原始字节入日志(日志保持原始字节,查看时用文本)
      if (logStream && logBytes < MAX_LOG_BYTES) {
        logBytes += chunk.length;
        if (logBytes <= MAX_LOG_BYTES) {
          logStream.write(chunk);
        } else {
          logStream.write(chunk.subarray(0, chunk.length - (logBytes - MAX_LOG_BYTES)));
          logStream.end();
          logStream = null;
        }
      }
      // 统一解码:字节全部喂入 decodeSeg,由它判定编码(UTF-8 完整/未完成前缀/GBK)并返回输出 + 待续 rest;
      // ANSI 保留原文(前端 ansiToHtml 渲染彩色;日志文件保持原始字节,见上方 logStream)
      holder.bytes = Buffer.concat([holder.bytes, chunk]);
      const { text, rest } = decodeSeg(holder.bytes);
      holder.bytes = rest;
      if (text) {
        shell.output = (shell.output + text).slice(-MAX_OUTPUT_BYTES);
        shell.streamBuf += text;
      }
      if (shell.streamBuf && !shell.flushTimer) {
        shell.flushTimer = setTimeout(() => this.flushStream(shell), STREAM_THROTTLE_MS);
      }
    };
    child.stdout?.on("data", (c) => collect(c, outBuf));
    child.stderr?.on("data", (c) => collect(c, errBuf));
    child.on("exit", (code) => {
      untrackChild(child);
      // 冲掉残留缓冲(终局解码:不再等待未完成序列,UTF-8 尝试失败则 GBK)
      const outTail = finalDecode(outBuf.bytes);
      let errTail = finalDecode(errBuf.bytes);
      // 沙盒违规注解（与前台路径同源）：后台命令被沙盒拦下时同样必须可见，
      // 否则用户只看到"命令失败了"，无从判断是边界还是故障（清单腐化正是这样发生的）。
      const violationKey = typeof command === "string" ? undefined : command.violationKey;
      if (violationKey && errTail) errTail = annotateSandboxFailures(violationKey, errTail);
      outBuf.bytes = Buffer.alloc(0);
      errBuf.bytes = Buffer.alloc(0);
      const tail = outTail + errTail;
      if (tail) {
        shell.output = (shell.output + tail).slice(-MAX_OUTPUT_BYTES);
        shell.streamBuf += tail;
      }
      // 强制刷出剩余缓冲(防尾部丢失)
      this.flushStream(shell);
      shell.exitCode = code;
      this.shells.delete(id);
      logStream?.end();
      void shell.releaseSandboxLease?.();
      console.log(`[bg-shell] exit ${id}: code=${code} stopped=${shell.stopped}`);
      shell.onExit?.(shell);
      this.broadcastCount();
    });
    child.on("error", (err) => {
      untrackChild(child);
      // spawn 失败(如 shell 不存在)——同 exit 路径注销,避免悬挂
      if (this.shells.has(id)) {
        this.flushStream(shell);
        shell.exitCode = -1;
        this.shells.delete(id);
        logStream?.end();
        void shell.releaseSandboxLease?.();
        console.log(`[bg-shell] spawn error ${id}: ${err.message}`);
        shell.onExit?.(shell);
        this.broadcastCount();
      }
    });
    return { id, logPath };
  }

  /** 停止后台命令:立即标记 stopping 并广播(前端即时反馈),杀进程树,
   *  5s 未退出(进程不响应 SIGTERM)强制 SIGKILL 兜底;返回是否找到。
   *  source = 主动停止来源(默认 user,前端按钮路径) */
  stop(id: string, source: ShellStopSource = "user"): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.stopped = true;
    // 记录停止来源先于进程退出:退出回调(formatShellResult)按它生成文案
    shell.stoppedBy = source;
    shell.status = "stopping";
    this.broadcastCount();
    console.log(`[bg-shell] stop ${id}: ${shell.command.slice(0, 80)}`);
    const killTree = (signal: NodeJS.Signals): void => {
      try {
        if (process.platform === "win32") {
          const tk = spawn("taskkill", ["/pid", String(shell.child.pid), "/T", "/F"]);
          tk.on("error", () => shell.child.kill());
        } else if (shell.child.pid) {
          process.kill(-shell.child.pid, signal);
        }
      } catch {
        shell.child.kill();
      }
    };
    killTree("SIGTERM");
    // SIGKILL 兜底:进程不响应 SIGTERM 时强制击杀(超时后 shell 已注销则跳过)
    setTimeout(() => {
      if (this.shells.has(id) && shell.exitCode === null) {
        console.log(`[bg-shell] force kill ${id}: SIGTERM 未响应,发送 SIGKILL`);
        killTree("SIGKILL");
      }
    }, FORCE_KILL_AFTER_MS);
    return true;
  }

  /** 停止并清空全部后台进程(会话关闭/应用退出时调用) */
  stopAll(): void {
    for (const id of [...this.shells.keys()]) this.stop(id);
  }

  /**
   * 退出清场：对仍未退出的进程组立刻补 SIGKILL。
   *
   * 为什么需要它：stop() 的「5s 未响应 SIGTERM → SIGKILL」依赖主进程活着，而退出路径上
   * 主进程先走，那个 setTimeout 永远不会执行（写了等于没写）——忽略 SIGTERM 的进程
   * 就会以孤儿身份留下。退出清场在宽限期后直接调这里补刀，不依赖定时器。
   */
  forceKillAll(pids: readonly number[] = this.list().map((shell) => shell.child.pid).filter((pid): pid is number => !!pid)): void {
    for (const pid of pids) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(pid), "/T", "/F"]).on("error", () => {});
        } else {
          process.kill(-pid, "SIGKILL");
        }
      } catch { /* 整组已退出 */ }
    }
  }

  /** 权限收紧时撤销该会话旧进程持有的执行能力。 */
  stopBySession(sessionId: string): void {
    for (const shell of this.shells.values()) {
      if (shell.sessionId === sessionId) this.stop(shell.id, "revoke");
    }
  }

  list(): BackgroundShell[] {
    return [...this.shells.values()];
  }

  /** 测试用:强制清空注册表 */
  reset(): void {
    for (const s of this.shells.values()) {
      if (s.flushTimer) clearTimeout(s.flushTimer);
    }
    this.shells.clear();
  }
}

export const backgroundShellRegistry = new BackgroundShellRegistry();
