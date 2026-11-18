/**
 * Windows ACL 沙盒专用子进程。
 *
 * srt-win 的 allowRead/allowWrite 会在 initialize 时写入 srt-sandbox 账户 ACL，
 * 不能在主进程的共享 SandboxManager 上动态修改。一个 worker 只服务一个
 * owner + workspace + mode，上层在权限降级时销毁对应 worker。
 */
import { SandboxManager, VENDORED_SRT_WIN_EXE, type SandboxRuntimeConfig, type WindowsBinShell } from "@anthropic-ai/sandbox-runtime";
import { unpackedAsarPath } from "./srt-win";
import type { ExecutionContext } from "../permission/execution-context";
import type { WindowsSandboxWorkerRequest, WindowsSandboxWorkerResponse } from "./windows-worker-protocol";

let activeContext: ExecutionContext | undefined;
const leases = new Set<string>();

function send(message: WindowsSandboxWorkerResponse): void {
  if (process.send) process.send(message);
}

function shellFor(shell: "bash" | "powershell", gitBashPath?: string): string | WindowsBinShell {
  if (shell === "powershell") return "powershell";
  // gitBashPath 只来自主进程的安装探测，不读取工作区配置；SRT 还会再次校验形态。
  if (gitBashPath) return { exe: gitBashPath, args: ["-c"] };
  throw new Error("Windows 受保护命令需要 Git Bash。请安装 Git for Windows 后重试。");
}

async function initialize(context: ExecutionContext, policy: SandboxRuntimeConfig): Promise<void> {
  if (activeContext) return;
  await SandboxManager.initialize({
    ...policy,
    // 打包后 VENDORED_SRT_WIN_EXE 落在 app.asar 内，而 srt 是 spawn 它 —— 必须先改写到
    // `.asar.unpacked`，否则 ENOTDIR（详见 srt-win.ts 文件头）
    windows: { srtWin: { path: unpackedAsarPath(VENDORED_SRT_WIN_EXE) } },
  });
  activeContext = context;
}

process.on("message", (raw: WindowsSandboxWorkerRequest) => {
  void (async () => {
    try {
      if (raw.type === "initialize") {
        await initialize(raw.context, raw.policy);
        send({ type: "ready", requestId: raw.requestId });
        return;
      }
      if (raw.type === "wrap") {
        if (!activeContext) throw new Error("Windows 沙盒 worker 尚未初始化");
        const wrapped = await SandboxManager.wrapWithSandboxArgv(
          raw.command,
          shellFor(raw.shell, raw.gitBashPath),
          undefined,
          undefined,
          activeContext.workspaceRealPath,
          { commandId: raw.commandId },
        );
        leases.add(raw.commandId);
        send({
          type: "wrapped",
          requestId: raw.requestId,
          argv: wrapped.argv,
          // SRT 环境含代理令牌和 Windows 沙盒运行参数，必须覆盖普通执行环境。
          env: { ...activeContext.environment, ...wrapped.env },
        });
        return;
      }
      if (raw.type === "release") {
        leases.delete(raw.leaseId);
        send({ type: "released", requestId: raw.requestId });
        return;
      }
      if (raw.type === "shutdown") {
        // 先让已启动的 srt-win 子进程由父进程终止，再撤销本 worker 的会话 ACL。
        if (leases.size > 0 && !raw.force) throw new Error("Windows 沙盒仍有活动命令，不能撤销权限");
        leases.clear();
        await SandboxManager.reset();
        activeContext = undefined;
        send({ type: "stopped", requestId: raw.requestId });
        process.disconnect?.();
        return;
      }
    } catch (error) {
      send({ type: "error", requestId: raw.requestId, message: (error as Error).message });
    }
  })();
});
