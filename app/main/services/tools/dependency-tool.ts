import path from "node:path";
import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { ensureSandbox, wrapForSandbox, isSandboxBypassedForMode, type SandboxSpawnSpec } from "../sandbox/manager";
import { executeForeground } from "../background-shell/tool";
import { EXECUTION_POLICY } from "../permission/wrap-tool";
import { createExecutionContext, type ExecutionContext } from "../permission/execution-context";
import { sandboxGitBashPath } from "../background-shell/registry";

type Manager = "npm" | "pnpm" | "yarn" | "bun" | "pip" | "uv" | "cargo" | "go" | "dart" | "flutter" | "mise";

function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function packageArgs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("至少提供一个依赖或工具名称");
  return value.map((item) => {
    const spec = String(item).trim();
    if (!spec || /[\0\r\n]/.test(spec)) throw new Error("依赖名称格式无效");
    return spec;
  });
}

function installCommand(manager: Manager, packages: string[], scope: "project" | "user", dev: boolean, cwd: string): string {
  const args = packages.map(quote).join(" ");
  switch (manager) {
    case "npm": return `npm install ${scope === "user" ? "--global " : dev ? "--save-dev " : ""}${args}`;
    case "pnpm": return `pnpm add ${scope === "user" ? "--global " : dev ? "--save-dev " : ""}${args}`;
    case "yarn": return `yarn ${scope === "user" ? "global add" : "add"}${dev && scope === "project" ? " --dev" : ""} ${args}`;
    case "bun": return `bun add ${scope === "user" ? "--global " : dev ? "--dev " : ""}${args}`;
    case "pip": {
      const venvPython = process.platform === "win32"
        ? path.join(cwd, ".venv", "Scripts", "python.exe")
        : path.join(cwd, ".venv", "bin", "python");
      if (scope === "user") return `python -m pip install --user ${args}`;
      return `([ -x ${quote(venvPython)} ] || python -m venv ${quote(path.join(cwd, ".venv"))}) && ${quote(venvPython)} -m pip install ${args}`;
    }
    case "uv": return `uv ${scope === "project" ? "add" : "tool install"} ${args}`;
    case "cargo": return `cargo ${scope === "project" ? "add" : "install"} ${dev && scope === "project" ? "--dev " : ""}${args}`;
    case "go": return `go ${scope === "project" ? "get" : "install"} ${args}`;
    case "dart": return `dart pub ${scope === "project" ? "add" : "global activate"} ${args}`;
    case "flutter": return scope === "project" ? `flutter pub add ${args}` : `dart pub global activate ${args}`;
    case "mise": return `mise use ${scope === "user" ? "--global " : ""}${args}`;
  }
}

function executionTarget(wrapped: SandboxSpawnSpec) {
  return wrapped.kind === "argv"
    ? { argv: wrapped.argv, env: wrapped.env, release: wrapped.release, violationKey: wrapped.violationKey, exemptReason: wrapped.exemptReason }
    : { command: wrapped.command, env: wrapped.env, release: wrapped.release, violationKey: wrapped.violationKey, exemptReason: wrapped.exemptReason };
}

export async function createDependencyTool(cwd: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "install_dependency",
    label: "安装依赖",
    description: "安装项目依赖或用户级开发工具。标准模式会把用户级安装、缓存和临时文件放入当前项目的专属开发运行区；完全访问使用宿主环境。安装脚本始终受系统核心保护。",
    promptSnippet: "安装项目依赖或开发工具",
    parameters: {
      type: "object" as const,
      properties: {
        manager: { type: "string" as const, enum: ["npm", "pnpm", "yarn", "bun", "pip", "uv", "cargo", "go", "dart", "flutter", "mise"] },
        packages: { type: "array" as const, items: { type: "string" as const }, description: "依赖或工具名称，可包含版本" },
        scope: { type: "string" as const, enum: ["project", "user"], description: "project 修改当前项目；user 安装到当前模式的用户级工具位置" },
        dev: { type: "boolean" as const, description: "支持时作为开发依赖安装" },
      },
      required: ["manager", "packages", "scope"],
    },
    async execute(_id: string, params: Record<string, unknown>, signal?: AbortSignal, onUpdate?: any) {
      const manager = String(params.manager) as Manager;
      const supported: Manager[] = ["npm", "pnpm", "yarn", "bun", "pip", "uv", "cargo", "go", "dart", "flutter", "mise"];
      if (!supported.includes(manager)) throw new Error(`不支持的依赖管理器：${manager}`);
      const scope = params.scope === "user" ? "user" : "project";
      const packages = packageArgs(params.packages);
      const context = (params as Record<PropertyKey, unknown>)[EXECUTION_POLICY] as ExecutionContext | undefined
        ?? createExecutionContext(cwd, "standard");
      const command = installCommand(manager, packages, scope, params.dev === true, context.workspaceRealPath);
      // 关沙盒**只换执行后端，不跳过环境处理**：wrapForSandbox 两条分支都返回「命令 + 编译后环境」，
      // 所以执行目标一律由它产出。（此前"关沙盒"分支直接传裸命令字符串 ⇒ resolveSpawn 落回宿主
      // process.env ⇒ 标准/只读档的运行区隔离在安装依赖这条路径上整体失效。）
      const sandboxed = !isSandboxBypassedForMode(context.mode);
      if (sandboxed) {
        const initialized = await ensureSandbox(context.workspaceRealPath, context.mode);
        if (!initialized.ok) throw new Error(`系统保护初始化失败：${initialized.reason}`);
      }
      const wrapped = await wrapForSandbox(command, {
        context, signal,
        gitBashPath: sandboxGitBashPath(),
      });
      const target = executionTarget(wrapped);
      return executeForeground(target, context.workspaceRealPath, signal, undefined, undefined, onUpdate);
    },
  } as any) as ToolDefinition;
}

export const dependencyToolInternals = { installCommand, packageArgs, executionTarget };
