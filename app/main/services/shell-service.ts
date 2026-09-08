import { spawn } from "child_process";
import { resolveHome } from "../utils/paths";
import { createCodingAwareDecoder } from "./background-shell/encoding";
import { isSystemMutationCommand } from "./permission/agent-permission-service";
import {
  isForbiddenReadPath,
  isForbiddenWritePath,
  isDevNull,
  normalizePath,
  extractPathsFromCommand,
  hitForbiddenLiteral,
} from "./permission/permission-rules";

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

/** 命令是否有写副作用（重定向落盘或写类命令前缀）——用户目录写禁区判定用 */
const WRITE_OP_RE = />+\s*[^\s"'|;&]|\b(?:rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|tee|dd|install|truncate)\b/i;

/**
 * shell:exec 禁区检查——与 Agent 权限层同一套规则（permission-rules）：
 * 系统级变更命令任何模式都拒；系统核心/凭据目录（含用户目录写）由路径级检查拦。
 * 返回拒绝原因；null = 放行。
 */
function checkForbiddenCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "命令为空";
  // 系统级变更命令（sudo/mount/launchctl/diskutil/osascript…——EM 不代做系统操作）
  if (isSystemMutationCommand(trimmed)) {
    return "系统级变更命令，禁止在 shell 通道执行（如需请手动在终端操作）";
  }
  // 禁区字面片段兜底（$HOME/.ssh/…、变量拼路径等静态提取解析不了时仍能命中）
  const literal = hitForbiddenLiteral(trimmed);
  if (literal) return `命令涉及禁止访问的位置（${literal}）`;
  // 能静态解析出路径 → 逐个禁区判定
  const paths = extractPathsFromCommand(trimmed);
  if (paths !== null) {
    const writeLike = WRITE_OP_RE.test(trimmed);
    for (const p of paths) {
      if (isDevNull(p)) continue;
      const norm = normalizePath(p);
      if (isForbiddenReadPath(norm)) return `路径在系统敏感位置或凭据目录，禁止访问：${p}`;
      if (writeLike && isForbiddenWritePath(norm)) return `写入路径在禁止访问的区域：${p}`;
    }
  } else if (WRITE_OP_RE.test(trimmed)) {
    // 写类命令路径含变量/命令替换无法确认目标——保守拒绝
    return "命令写入目标无法确认，已拒绝执行";
  }
  return null;
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
    const denied = checkForbiddenCommand(command);
    if (denied) {
      resolve({ code: -1, stdout: "", stderr: denied });
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
      resolve({ code, stdout, stderr });
    });

    proc.on("error", (err) => {
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
}
