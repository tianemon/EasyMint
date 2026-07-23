import { spawn } from "child_process";
import { resolveHome } from "../utils/paths";

export interface ShellExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Execute a shell command in the given working directory.
 * Streams stdout/stderr lines via callbacks, resolves with final result.
 */
export function execShell(
  projectPath: string,
  command: string,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
): Promise<ShellExecResult> {
  return new Promise((resolve) => {
    const cwd = resolveHome(projectPath);

    const proc = spawn("bash", ["-c", command], {
      cwd,
      env: { ...process.env },
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) onStdout(line);
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
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
