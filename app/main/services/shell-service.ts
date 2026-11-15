import { spawn } from "child_process";
import { resolveHome } from "../utils/paths";
import { trackChild, untrackChild } from "./process-registry";
import { createCodingAwareDecoder } from "./background-shell/encoding";
import { isSystemMutationCommand } from "./permission/agent-permission-service";
import { ensureSandbox, wrapForSandbox, annotateSandboxFailures } from "./sandbox/manager";
import { createExecutionContext } from "./permission/execution-context";
import { sandboxGitBashPath } from "./background-shell/registry";

/** 看门狗阈值：10 分钟没有任何输出、或总时长超过 60 分钟，就停掉并说明原因。
 *  两者都刻意给得宽——宁可晚一点收，也不要误杀正常的长时间构建。 */
const IDLE_LIMIT_MS = 10 * 60_000;
const TOTAL_LIMIT_MS = 60 * 60_000;

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

    // 看门狗：命令**永不退出**时（等 stdin、缺依赖弹了个看不见的错误框、网络挂住）原先会一直
    // pending，IPC 不返回、界面就停在"运行中"。判定用"没有任何输出"而不是总时长——长构建通常
    // 会持续打印；真正安静到 10 分钟无输出的，几乎都是卡住。
    let timedOutNote: string | null = null;
    let settled = false;
    let idleTimer: NodeJS.Timeout | undefined;

    const killTree = (): void => {
      try {
        if (process.platform === "win32" && proc.pid) {
          spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
            .once("error", () => { try { proc.kill(); } catch { /* 已退出 */ } });
        } else if (proc.pid) {
          process.kill(-proc.pid, "SIGKILL");   // detached = 独立进程组，整组收
        }
      } catch { try { proc.kill(); } catch { /* 已退出 */ } }
    };

    /** 停掉并给用户一句人话；即使进程赖着不退，也要把这次调用结束掉 */
    const stopWithNote = (note: string): void => {
      if (settled || timedOutNote) return;
      timedOutNote = note;
      stderr = stderr ? `${stderr}\n${note}` : note;   // 结果里也要带上，别只闪在界面上
      onStderr(note);
      killTree();
      // 兜底：某些子进程会忽略结束信号（或被系统钩子拦住），5 秒后无论如何都收尾
      setTimeout(() => finish(-1), 5000).unref?.();
    };

    const armIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stopWithNote(
        // 分钟数从常量算，别写死——改阈值时文案不会说谎
        `这条命令已经 ${Math.round(IDLE_LIMIT_MS / 60_000)} 分钟没有任何输出了，我先停掉它。`
        + "如果它本来就需要长时间安静地跑，请改用后台运行；也可以再执行一次。",
      ), IDLE_LIMIT_MS);
    };

    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
      untrackChild(proc);
      void spec.release?.();
      // 沙盒违规注解（与前台/后台同源）：UI 终端里用户直接读 stderr，
      // 没有注解就只看到"命令失败"，无从判断是边界还是故障（见 manager.annotateSandboxFailures）。
      // ⚠️ 只用返回值的 stderr——流式 onStderr 已经推过原文，重复注解会打断行渲染。
      const annotated = spec.violationKey && stderr
        ? annotateSandboxFailures(spec.violationKey, stderr)
        : stderr;
      resolve({ code: timedOutNote ? -1 : code, stdout, stderr: annotated });
    };

    const note = (text: string): void => { if (!timedOutNote) stderr += text; };

    armIdle();
    const totalTimer = setTimeout(() => stopWithNote(
      `这条命令跑了 ${Math.round(TOTAL_LIMIT_MS / 60_000)} 分钟还没结束，我先停掉它。`
      + "需要长期运行的服务（dev server 之类）请用后台运行。",
    ), TOTAL_LIMIT_MS);

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = outDec.feed(chunk);
      stdout += text;
      armIdle();
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) onStdout(line);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = errDec.feed(chunk);
      note(text);
      armIdle();
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) onStderr(line);
    });

    proc.on("close", (code) => finish(code));

    proc.on("error", (err) => {
      if (settled) return;
      stderr = stderr ? `${stderr}\n${err.message}` : err.message;
      finish(-1);
    });
  });
}
