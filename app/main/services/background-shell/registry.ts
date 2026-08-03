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

import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, readdirSync, rmSync, statSync, type WriteStream } from "node:fs";
import path from "node:path";
import { broadcast } from "../ipc-broadcast";

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
}

export interface BackgroundShell {
  id: string;
  command: string;
  startedAt: number;
  child: ChildProcess;
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

class BackgroundShellRegistry {
  private shells = new Map<string, BackgroundShell>();

  /** 广播当前 shell 列表给前端(ShellBar 显示/展开) */
  private broadcastCount(): void {
    broadcast("agent:shell-count", this.list().map((s) => ({
      id: s.id, command: s.command, startedAt: s.startedAt, status: s.status, logPath: s.logPath,
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
  start(command: string, cwd: string, onExit?: (shell: BackgroundShell) => void): { id: string; logPath: string } {
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

    // detached: 独立进程组,stop 时 kill(-pid) 可杀整个进程树(含孙进程)
    const child = spawn(command, { shell: true, cwd, detached: true });
    const shell: BackgroundShell = {
      id, command, startedAt: Date.now(), child, output: "", logPath,
      exitCode: null, stopped: false, status: "running", streamBuf: "", flushTimer: null, onExit,
    };
    this.shells.set(id, shell);
    this.broadcastCount();
    console.log(`[bg-shell] started ${id}: ${command.slice(0, 80)}`);

    const collect = (chunk: Buffer): void => {
      shell.output = (shell.output + chunk.toString()).slice(-MAX_OUTPUT_BYTES);
      // 输出缓冲 + 100ms 节流广播(高频输出合并,防 IPC 风暴)
      shell.streamBuf += chunk.toString();
      if (!shell.flushTimer) {
        shell.flushTimer = setTimeout(() => this.flushStream(shell), STREAM_THROTTLE_MS);
      }
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
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("exit", (code) => {
      // 退出时强制刷出剩余缓冲(防尾部丢失)
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
