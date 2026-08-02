/**
 * 后台 shell 注册表 — 管理 Mint 以 background: true 启动的长驻命令进程
 *
 * 对标 Claude Code 的 run_in_background:spawn 子进程后工具立即返回,
 * 进程由主进程侧托管。按 id(toolCallId)注册,支持停止(杀进程树)、
 * 输出收集(尾部截断)、会话清理。
 */

import { spawn, type ChildProcess } from "node:child_process";

/** 保留输出尾部上限(超出截断,防止内存膨胀) */
const MAX_OUTPUT_BYTES = 4096;

export interface BackgroundShell {
  id: string;
  command: string;
  startedAt: number;
  child: ChildProcess;
  /** 累积输出(尾部截断) */
  output: string;
  /** 退出码(null = 尚未退出) */
  exitCode: number | null;
  /** 被 stop() 主动停止(true 时格式化结果标记「中止」,与自然失败区分) */
  stopped: boolean;
  /** 进程退出回调(自然结束或被停止),exitCode 已写入 */
  onExit?: (shell: BackgroundShell) => void;
}

class BackgroundShellRegistry {
  private shells = new Map<string, BackgroundShell>();

  /** 启动后台命令,立即返回 id;进程退出时自动注销并回调 onExit */
  start(command: string, cwd: string, onExit?: (shell: BackgroundShell) => void): string {
    const id = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // detached: 独立进程组,stop 时 kill(-pid) 可杀整个进程树(含孙进程)
    const child = spawn(command, { shell: true, cwd, detached: true });
    const shell: BackgroundShell = {
      id, command, startedAt: Date.now(), child, output: "", exitCode: null, stopped: false, onExit,
    };
    this.shells.set(id, shell);

    const collect = (chunk: Buffer): void => {
      shell.output = (shell.output + chunk.toString()).slice(-MAX_OUTPUT_BYTES);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("exit", (code) => {
      shell.exitCode = code;
      this.shells.delete(id);
      shell.onExit?.(shell);
    });
    child.on("error", () => {
      // spawn 失败(如 shell 不存在)——同 exit 路径注销,避免悬挂
      if (this.shells.has(id)) {
        shell.exitCode = -1;
        this.shells.delete(id);
        shell.onExit?.(shell);
      }
    });
    return id;
  }

  /** 停止后台命令(杀进程树);返回是否找到 */
  stop(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    shell.stopped = true;
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(shell.child.pid), "/T", "/F"]);
      } else if (shell.child.pid) {
        process.kill(-shell.child.pid, "SIGTERM");
      }
    } catch {
      shell.child.kill();
    }
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
    this.shells.clear();
  }
}

export const backgroundShellRegistry = new BackgroundShellRegistry();
