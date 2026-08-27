/**
 * 后台 shell 注册表 — 管理 Mint 以 background: true 启动的长驻命令进程
 *
 * 对标 Claude Code 的 run_in_background:spawn 子进程后工具立即返回,
 * 进程由主进程侧托管。按 id(toolCallId)注册,支持停止(杀进程树)、
 * 输出收集(尾部截断 + 完整落盘)、会话清理。
 *
 * 通知/停止闭环(对齐 task 工具优化经验):
 * - 完整输出落盘 <cwd>/.easymint/shell-logs/<id>.log(保留 7 天自动清理),通知只带尾部预览
 * - stop() 立即置 stopping 并广播(前端即时反馈),5s 未退出 SIGKILL 兜底
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, type WriteStream } from "node:fs";
import path from "node:path";
import { broadcast } from "../ipc-broadcast";
import { decodeSeg, finalDecode } from "./encoding";

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
  /** 运行状态(running → stopping → 退出注销) */
  status: "running" | "stopping";
  /** 待广播的输出缓冲(100ms 节流合并,agent:shell-output) */
  streamBuf: string;
  /** 节流定时器(null = 无待刷) */
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** 进程退出回调(自然结束或被停止),exitCode 已写入 */
  onExit?: (shell: BackgroundShell) => void;
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
function findBashOnWindows(): string | null {
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

/** 后台命令的 spawn 配置:Windows 用 Git Bash -c(对齐 Pi 工具,支持 cd /c/... 和管道 tail);
 *  Windows 无 Git Bash → 报错(错误信息进入工具结果,Mint 读到后自行调整策略);
 *  Unix 保持 shell:true(行为不变)。
 *  前台 bash(tool.ts)复用此配置。 */
export function resolveSpawn(command: string, cwd: string): { file: string; args: string[]; opts: Parameters<typeof spawn>[2]; error?: string } {
  if (process.platform === "win32") {
    const bash = findBashOnWindows();
    if (bash) {
      return {
        file: bash,
        args: ["-c", command],
        // Windows 不 detached(会导致 stdout/stderr 管道收不到数据);进程树清理走 taskkill /T
        // 注:LANG/LC_ALL 对 Windows 原生程序无效(编码由系统代码页决定),乱码由 encoding.ts 解码容错解决
        opts: { cwd, windowsHide: true },
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
    opts: { shell: true, cwd, detached: true },
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
      broadcast("agent:shell-output", { id: shell.id, chunk: shell.streamBuf });
      shell.streamBuf = "";
    }
  }

  /** 启动后台命令,立即返回 id + 输出文件路径;进程退出时自动注销并回调 onExit */
  start(command: string, cwd: string, onExit?: (shell: BackgroundShell) => void, sessionId?: string): { id: string; logPath: string } {
    const id = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // 完整输出落盘项目级 .easymint/shell-logs/(持久可回看);
    // 启动时顺带清理超过保留期的旧日志,防积累
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
    const { file, args, opts, error } = resolveSpawn(command, cwd);
    if (error) {
      // 构造已失败 shell:输出=错误信息,立即走退出注销路径(结果注入主会话,Mint 读到后自行调整)
      logStream?.write(error);
      const shell: BackgroundShell = {
        id, command, startedAt: Date.now(), child: null as unknown as ChildProcess, output: error, logPath,
        exitCode: -1, stopped: false, status: "running", streamBuf: "", flushTimer: null, onExit,
        sessionId,
      };
      this.shells.set(id, shell);
      this.broadcastCount();
      console.warn(`[bg-shell] no bash on windows ${id}: ${error.slice(0, 80)}`);
      setTimeout(() => {
        if (this.shells.has(id)) {
          shell.exitCode = -1;
          this.shells.delete(id);
          logStream?.end();
          shell.onExit?.(shell);
          this.broadcastCount();
        }
      }, 0);
      return { id, logPath };
    }
    const child = spawn(file, args, opts);
    const shell: BackgroundShell = {
      id, command, startedAt: Date.now(), child, output: "", logPath,
      exitCode: null, stopped: false, status: "running", streamBuf: "", flushTimer: null, onExit,
      sessionId,
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
      // 冲掉残留缓冲(终局解码:不再等待未完成序列,UTF-8 尝试失败则 GBK)
      const outTail = finalDecode(outBuf.bytes);
      const errTail = finalDecode(errBuf.bytes);
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
      console.log(`[bg-shell] exit ${id}: code=${code} stopped=${shell.stopped}`);
      shell.onExit?.(shell);
      this.broadcastCount();
    });
    child.on("error", (err) => {
      // spawn 失败(如 shell 不存在)——同 exit 路径注销,避免悬挂
      if (this.shells.has(id)) {
        this.flushStream(shell);
        shell.exitCode = -1;
        this.shells.delete(id);
        logStream?.end();
        console.log(`[bg-shell] spawn error ${id}: ${err.message}`);
        shell.onExit?.(shell);
        this.broadcastCount();
      }
    });
    return { id, logPath };
  }

  /** 停止后台命令:立即标记 stopping 并广播(前端即时反馈),杀进程树,
   *  5s 未退出(进程不响应 SIGTERM)强制 SIGKILL 兜底;返回是否找到 */
  stop(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.stopped = true;
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
