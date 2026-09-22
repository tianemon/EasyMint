import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { emHome } from "../../utils/paths";
import {
  canonicalPolicyPath,
  isWithin,
  pathHitsAny,
  protectedControlPaths,
  protectedCredentialPaths,
  protectedWriteRoots,
} from "../permission/access-policy";

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MANAGED_DIR = emHome();
const MANAGED_ENV = path.join(MANAGED_DIR, "environment.sh");
const CONTROL_TMP = path.join(MANAGED_DIR, ".control-tmp");
const LEGACY_HOOK_RE = /(?:^|\n)# >>> EasyMint managed environment >>>\n[\s\S]*?\n# <<< EasyMint managed environment <<<(?:\n|$)/g;
const USER_ENV_DENY = new Set([
  "BASH_ENV", "ENV", "ZDOTDIR", "PROMPT_COMMAND", "SHELLOPTS",
  "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS", "RUBYOPT", "PERL5OPT", "PYTHONSTARTUP",
  "GIT_EXEC_PATH", "GIT_SSH_COMMAND", "GIT_TEMPLATE_DIR",
  "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "ELECTRON_RUN_AS_NODE",
]);

function stripLegacyManagedHook(content: string): string {
  return content.replace(LEGACY_HOOK_RE, "\n").replace(/^\n+/, "");
}

function shellLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** 只解析本工具生成的固定 export 格式，不执行 shell 内容。 */
function parseManagedEnvironment(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = /^export ([A-Za-z_][A-Za-z0-9_]*)=('(?:[^']|'"'"')*')$/.exec(line);
    if (!match) continue;
    result[match[1]!] = match[2]!.slice(1, -1).replace(/'"'"'/g, "'");
  }
  return result;
}

export function readManagedEnvironment(): Record<string, string> {
  try { return parseManagedEnvironment(fs.readFileSync(MANAGED_ENV, "utf8")); }
  catch { return {}; }
}

function updateKeyValue(content: string, name: string, value: string | undefined, render: (name: string, value: string) => string): string {
  const lines = content ? content.replace(/\n$/, "").split("\n") : [];
  const matcher = new RegExp(`^(?:export\\s+)?${name}=`);
  const next = lines.filter((line) => !matcher.test(line));
  if (value !== undefined) next.push(render(name, value));
  return next.length > 0 ? `${next.join("\n")}\n` : "";
}

function atomicWrite(file: string, content: string, protectedTemp = false): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempDir = protectedTemp ? CONTROL_TMP : path.dirname(file);
  fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
  const tempStat = fs.lstatSync(tempDir);
  if (!tempStat.isDirectory() || tempStat.isSymbolicLink()) {
    throw new Error("受管理环境临时目录不安全，已拒绝写入");
  }
  if (protectedTemp) fs.chmodSync(tempDir, 0o700);
  const temp = path.join(tempDir, `${path.basename(file)}.${randomUUID()}.tmp`);
  const mode = fs.existsSync(file) ? fs.statSync(file).mode & 0o777 : 0o600;
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
    | (fs.constants.O_NOFOLLOW ?? 0);
  const fd = fs.openSync(temp, flags, mode);
  try {
    fs.writeFileSync(fd, content, { encoding: "utf8" });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, file);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch { /* 清理失败不覆盖原异常 */ }
    throw e;
  }
}

function removeLegacyManagedHook(): void {
  for (const name of [".zshrc", ".zprofile", ".bashrc", ".bash_profile", ".profile"]) {
    const rc = path.join(os.homedir(), name);
    if (!fs.existsSync(rc)) continue;
    try {
      const stat = fs.lstatSync(rc);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const current = fs.readFileSync(rc, "utf8");
      const next = stripLegacyManagedHook(current);
      if (next !== current) atomicWrite(rc, next, true);
    } catch (e) {
      console.warn(`[environment] 清理旧 shell 加载块失败 ${rc}:`, (e as Error).message);
    }
  }
}

export async function createEnvironmentTool(projectPath: string): Promise<ToolDefinition> {
  removeLegacyManagedHook();
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "set_environment",
    label: "设置环境变量",
    description: "安全设置或移除项目级 .env 或 EasyMint 用户环境变量。值按字面量保存，不执行其中的命令或替换。用户级修改只对以后启动的 EasyMint 终端和任务生效。",
    promptSnippet: "设置开发所需的项目或用户环境变量",
    parameters: {
      type: "object" as const,
      properties: {
        scope: { type: "string" as const, enum: ["project", "user"], description: "project 写当前项目 .env；user 写 EasyMint 管理的用户环境文件" },
        name: { type: "string" as const, description: "变量名，只允许字母、数字和下划线，且不能以数字开头" },
        value: { type: "string" as const, description: "变量值；action=set 时必填，按字面值保存" },
        action: { type: "string" as const, enum: ["set", "remove"], description: "设置或移除变量" },
      },
      required: ["scope", "name", "action"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const scope = params.scope === "user" ? "user" : "project";
      const action = params.action === "remove" ? "remove" : "set";
      const name = String(params.name || "");
      if (!NAME_RE.test(name)) throw new Error("环境变量名格式无效");
      if (action === "set" && typeof params.value !== "string") throw new Error("设置环境变量时必须提供 value");
      const value = action === "set" ? String(params.value) : undefined;
      if (value?.includes("\0")) throw new Error("环境变量值不能包含 NUL 字符");

      if (scope === "user") {
        if (process.platform === "win32") throw new Error("Windows 用户环境变量安全写入尚未实现，已拒绝修改");
        if (action === "set" && USER_ENV_DENY.has(name.toUpperCase())) {
          throw new Error(`用户环境变量 ${name} 会改变程序加载或命令执行路径，已拒绝持久化`);
        }
        if (value && /[\r\n]/.test(value)) throw new Error("用户级持久环境变量暂不支持换行；项目 .env 可保存换行值");
        const current = fs.existsSync(MANAGED_ENV) ? fs.readFileSync(MANAGED_ENV, "utf8") : "";
        atomicWrite(MANAGED_ENV, updateKeyValue(current, name, value, (key, val) => `export ${key}=${shellLiteral(val)}`), true);
        return { content: [{ type: "text" as const, text: `已${action === "set" ? "设置" : "移除"} EasyMint 用户环境变量 ${name}；新启动的 EasyMint 终端和任务将生效。` }], details: {} };
      }

      const file = path.join(projectPath, ".env");
      const target = canonicalPolicyPath(file, projectPath);
      const workspace = canonicalPolicyPath(projectPath, projectPath);
      if (!isWithin(workspace, target)) {
        throw new Error("项目环境文件指向工作区之外，已拒绝修改");
      }
      if (pathHitsAny(target, [
        ...protectedWriteRoots(),
        ...protectedCredentialPaths(),
        ...protectedControlPaths(projectPath),
      ], projectPath)) {
        throw new Error("项目环境文件位于系统核心或敏感路径，已拒绝修改");
      }
      if (fs.existsSync(file)) {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) {
          throw new Error("项目环境文件不是安全的普通文件，已拒绝修改");
        }
      }
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      atomicWrite(file, updateKeyValue(current, name, value, (key, val) => `${key}=${JSON.stringify(val)}`));
      return { content: [{ type: "text" as const, text: `已${action === "set" ? "设置" : "移除"}项目环境变量 ${name}。` }], details: {} };
    },
  } as any) as ToolDefinition;
}

export const environmentToolInternals = {
  shellLiteral,
  parseManagedEnvironment,
  updateKeyValue,
  removeLegacyManagedHook,
  stripLegacyManagedHook,
  isDeniedUserVariable: (name: string) => USER_ENV_DENY.has(name.toUpperCase()),
};
