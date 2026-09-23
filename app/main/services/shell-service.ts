import { spawn } from "child_process";
import { resolveHome } from "../utils/paths";
import { trackChild, untrackChild } from "./process-registry";
import { createCodingAwareDecoder } from "./background-shell/encoding";
import { isSystemMutationCommand } from "./permission/agent-permission-service";
import { ensureSandbox, wrapForSandbox, annotateSandboxFailures } from "./sandbox/manager";
import { createExecutionContext } from "./permission/execution-context";
import { sandboxGitBashPath } from "./background-shell/registry";

export interface ShellExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Execute a shell command in the given working directory.
 * Streams stdout/stderr lines via callbacks, resolves with final result.
 */
/**
 * shell:exec 使用标准模式运行时策略。这里只提前拒绝明确的系统控制命令；
 * 动态路径、变量和子进程的真实 I/O 由 OS 沙盒强制限制。
 * 返回拒绝原因；null = 放行。
 */
function checkForbiddenCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "命令为空";
  if (isSystemMutationCommand(trimmed)) {
    return "系统级变更命令，禁止在 shell 通道执行（如需请手动在终端操作）";
  }
  return null;
}

export async function execShell(
  projectPath: string,
  command: string,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
): Promise<ShellExecResult> {
  const denied = checkForbiddenCommand(command);
  if (denied) return { code: -1, stdout: "", stderr: denied };
  const cwd = resolveHome(projectPath);
  const sandbox = await ensureSandbox(cwd);
  if (!sandbox.ok) return { code: -1, stdout: "", stderr: `安全执行后端不可用：${sandbox.reason}` };
  let spec;
  try {
    spec = await wrapForSandbox(command, {
      context: createExecutionContext(cwd, "standard"),
      gitBashPath: sandboxGitBashPath(),
    });
  } catch (e) {
    return { code: -1, stdout: "", stderr: `安全执行包装失败：${(e as Error).message}` };
  }
  return new Promise((resolve) => {
    // Unix 下 detached：与前台 bash / 后台 shell 同策略，让命令自成进程组，
    // 退出清场能整组收掉（否则 kill 只能命中 sh 本身，其子进程留成孤儿）。
    // Windows 不加 detached（会使 stdout/stderr 管道收不到数据，见 background-shell/registry）。
    const spawnOpts = {
      cwd,
      env: spec.env,
      detached: process.platform !== "win32",
    };
    const proc = spec.kind === "argv"
      ? spawn(spec.argv[0]!, spec.argv.slice(1), { ...spawnOpts, shell: false })
      : spawn(spec.command, { ...spawnOpts, shell: true });
    // 登记进退出清场（EM 退出时统一杀，见 services/process-registry.ts）
    trackChild(proc, { detached: spawnOpts.detached });

    let stdout = "";
    let stderr = "";
    // 流式解码（chunk 截断不乱码）；ANSI 保留原文（前端渲染彩色）
    const outDec = createCodingAwareDecoder();
    const errDec = createCodingAwareDecoder();

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = outDec.feed(chunk);
      stdout += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) onStdout(line);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = errDec.feed(chunk);
      stderr += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) onStderr(line);
    });

    proc.on("close", (code) => {
      untrackChild(proc);
      void spec.release?.();
      // 沙盒违规注解（与前台/后台同源）：UI 终端里用户直接读 stderr，
      // 没有注解就只看到"命令失败"，无从判断是边界还是故障（见 manager.annotateSandboxFailures）。
      // ⚠️ 只用返回值的 stderr——流式 onStderr 已经推过原文，重复注解会打断行渲染。
      const annotated = spec.violationKey && stderr
        ? annotateSandboxFailures(spec.violationKey, stderr)
        : stderr;
      resolve({ code, stdout, stderr: annotated });
    });

    proc.on("error", (err) => {
      untrackChild(proc);
      void spec.release?.();
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
}
