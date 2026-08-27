import { spawn } from "child_process";
import { resolveHome } from "../utils/paths";
import { createCodingAwareDecoder, stripAnsi } from "./background-shell/encoding";

export interface ShellExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Execute a shell command in the given working directory.
 * Streams stdout/stderr lines via callbacks, resolves with final result.
 */
/** 检测命令中是否包含注入模式（命令替换等） */
function hasInjectionPattern(command: string): boolean {
  // $(...) / `...` 命令替换
  if (/\$\(/.test(command) || /`[^`]*`/.test(command)) return true;
  return false;
}

export function execShell(
  projectPath: string,
  command: string,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
): Promise<ShellExecResult> {
  return new Promise((resolve) => {
    if (hasInjectionPattern(command)) {
      resolve({ code: -1, stdout: "", stderr: "命令包含不安全的注入模式" });
      return;
    }

    const cwd = resolveHome(projectPath);

    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env },
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    // 流式解码（chunk 截断不乱码）+ 剥离 ANSI
    const outDec = createCodingAwareDecoder();
    const errDec = createCodingAwareDecoder();

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = stripAnsi(outDec.feed(chunk));
      stdout += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) onStdout(line);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = stripAnsi(errDec.feed(chunk));
      stderr += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) onStderr(line);
    });

    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on("error", (err) => {
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
}
