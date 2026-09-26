/**
 * Pi 单会话封装 — create/resume/prompt/steer/abort/dispose
 *
 * 通过 pi-sdk.ts wrapper 懒加载 Pi SDK（ESM-only → CJS dynamic import）
 */

import type {
  AgentSession,
  CreateAgentSessionOptions,
  ToolDefinition,
  SessionManager,
} from "./pi-sdk";
import type { ExtensionError, InlineExtension } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  getDefaultResourceLoaderClass,
  getCreateCodingTools,
  getCreateExtraBuiltinTools,
  clearPiExtensionCache,
} from "./pi-sdk";
import { ensureSessionManagerClass, getPiSessionDir } from "./pi-session-dir";
import { createEnhancedBashTool, createStopShellTool } from "./background-shell/tool";
import { createEnhancedPowerShellTool } from "./background-shell/powershell-tool";
import { createEnhancedEditTool } from "./enhanced-edit";
import { createEnhancedReadTool } from "./enhanced-read";
import type { BackgroundShell } from "./background-shell/registry";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { getSettingsManager, getModelRuntime } from "./pi-init";
import { Store } from "./store";
import { wrapToolWithPermission } from "./permission/wrap-tool";
import type { CanUseToolOptions, PermissionResult } from "./permission/agent-permission-service";
import { mergeIntoPiSkills } from "./skill-service";
import { discoverAvailableExtensions, recordPiExtensionError, recordPiExtensionStats } from "./pi-extension-service";
import { createPiExtensionUi } from "./pi-extension-ui";
import { normalizePermissionMode } from "./permission/execution-context";

// 目录工具再导出：既有调用点（project-service / session-service / migration-service /
// task/executor / agent-service）仍从本模块引用，避免无谓的 import 面改动。
// 实现在 pi-session-dir（独立模块，依赖面小、可单测）。`tryGetPiSessionDir` 供同步调用点
// 兜底（未预热时返回 undefined 而不抛），判据见其注释。
export { getPiSessionDir, tryGetPiSessionDir } from "./pi-session-dir";

// ── 类型 ────────────────────────────────────────────

export interface PiSessionOptions {
  cwd: string;
  agentDir: string;
  model?: Model<any>;
  thinkingLevel?: ThinkingLevel;
  store: Store;
  resumeSessionFile?: string;
  /** 会话落盘目录（缺省 getPiSessionDir(cwd)）；子 Agent 传 subagents/ 子目录避免平级出现在列表 */
  sessionDir?: string;
  systemPrompt?: string;
  isDesigner?: boolean;
  /** 额外的工具（task 等）。createPiSession 会自动追加基础 coding 工具 */
  extraTools?: ToolDefinition[];
  /** 权限回调：对所有工具（含基础 coding 工具）生效；缺省不包装 */
  canUseTool?: (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;
  /** 后台 shell 进程退出回调（主会话传入,结果注入主会话；缺省不通知） */
  onShellExit?: (shell: BackgroundShell) => void;
  onExtensionError?: (error: ExtensionError) => void;
  /** Executable Pi extensions require a full-access session. */
  permissionMode?: string;
  getPermissionMode?: () => string | undefined;
}

// ── 工厂函数 ────────────────────────────────────────

async function buildSession(
  opts: PiSessionOptions,
  sessionManager: SessionManager,
): Promise<AgentSession> {
  const settingsMgr = await getSettingsManager(opts.cwd, opts.agentDir);
  const modelRuntime = await getModelRuntime(opts.store);
  const DRL = await getDefaultResourceLoaderClass();
  const createTools = await getCreateCodingTools();
  const sdk = await import("@earendil-works/pi-coding-agent");
  // 实时权限门（纵深防御）：主防线是 agent-service 的 withSessionCreationLock——切档提交与
  // 「创建+登记」串行化，提交不会落在 reload 中途。锁外路径或未来回归下，这里在创建期异步
  // 边界复核实时模式：standard 一旦正式提交，后续边界不再把扩展交给 loader / bindExtensions。
  // 注意 await reload() 是单个 await，其内部「import → 工厂执行」无法插入检查——那个窗口
  // 只能靠锁的串行化消除，不是本门禁的能力范围。
  const liveMode = () => normalizePermissionMode(opts.getPermissionMode?.() ?? opts.permissionMode);
  const approvedExtensions = liveMode() === "full"
    ? (await discoverAvailableExtensions({ projectPath: opts.cwd }))
      .filter((item) => item.approved && item.enabledInPi && !!item.fingerprint)
      .map((item) => item.path)
    : [];
  const installedPackages = await new sdk.DefaultPackageManager({
    cwd: opts.cwd, agentDir: opts.agentDir, settingsManager: settingsMgr,
  }).resolve(async () => "skip");
  const packagePaths = (items: typeof installedPackages.skills) => items
    .filter((item) => item.enabled && item.metadata.origin === "package")
    .map((item) => item.path);

  const codingTools = createTools(opts.cwd);
  // bash 用增强版替换(原生 + background 参数):同名工具后者覆盖前者(agent-session Map.set)
  // 放在最后,确保覆盖 codingTools 中的原生 bash
  const enhancedBash = await createEnhancedBashTool(opts.cwd, { onExit: opts.onShellExit });
  // edit 用增强版替换(原生 + diff 注入返回文本):Mint 可见变更内容
  const enhancedEdit = await createEnhancedEditTool(opts.cwd);
  // read 用增强版替换(原生 + 二进制文档 pdf/docx/xlsx/pptx 抽取文本):非文档完全委托原生
  const enhancedRead = await createEnhancedReadTool(opts.cwd, codingTools);
  const codingToolsReplaced = codingTools.filter((t) => t.name !== "bash" && t.name !== "edit" && t.name !== "read");
  // grep/find/ls/powershell：SDK 内置但默认不激活（getCreateCodingTools 只含 read/bash/edit/write）。
  // 补齐后均可用——ls/find 纯 JS 立即可用；grep 依赖 rg（SDK 首次调用自动下载）；
  // powershell 只在 Windows 存在（SDK 在非 win32 下直接抛错，见其 utils/shell.js getPowerShellConfig），
  // 其他平台注册了也只会白占工具位并写进系统提示词，故按平台门禁。
  const {
    createGrepToolDefinition,
    createFindToolDefinition,
    createLsToolDefinition,
  } = await getCreateExtraBuiltinTools();
  const enhancedPowerShell = process.platform === "win32" ? await createEnhancedPowerShellTool(opts.cwd) : undefined;
  // 统一权限包装：extraTools 与基础 coding 工具、额外内置工具全部生效
  const wrapAll = (tools: ToolDefinition[]): ToolDefinition[] =>
    opts.canUseTool ? tools.map((t) => wrapToolWithPermission(t, { canUseTool: opts.canUseTool })) : tools;
  const tools = [
    ...wrapAll(opts.extraTools ?? []),
    ...wrapAll(codingToolsReplaced),
    ...wrapAll([
      enhancedBash,
      enhancedEdit,
      enhancedRead,
      createStopShellTool(),
      createGrepToolDefinition(opts.cwd),
      createFindToolDefinition(opts.cwd),
      createLsToolDefinition(opts.cwd),
      ...(enhancedPowerShell ? [enhancedPowerShell] : []),
    ]),
  ];

  const ownToolNames = new Set(tools.map((tool) => tool.name));
  const permissionExtension: InlineExtension = {
    name: "easymint-permission",
    hidden: true,
    factory(pi) {
      pi.on("tool_call", async (event, ctx) => {
        if (ownToolNames.has(event.toolName) || !opts.canUseTool) return;
        if (normalizePermissionMode(opts.getPermissionMode?.() ?? opts.permissionMode) !== "full") {
          return { block: true, reason: "Pi 扩展工具仅在完全访问模式可用" };
        }
        const decision = await opts.canUseTool(event.toolName, event.input, {
          signal: ctx.signal ?? new AbortController().signal,
          toolUseID: event.toolCallId,
          displayName: event.toolName,
        });
        if (decision.behavior === "deny") return { block: true, reason: decision.message || "操作被拒绝" };
        if (decision.updatedInput) Object.assign(event.input, decision.updatedInput);
      });
    },
  };
  // Resource discovery must not install packages merely because a project settings.json
  // names them. Extensions are resolved from the approved, already-installed file paths.
  const resourceSettings = sdk.SettingsManager.fromStorage({
    withLock(scope, fn) {
      const file = scope === "global"
        ? path.join(opts.agentDir, "settings.json")
        : path.join(opts.cwd, sdk.CONFIG_DIR_NAME, "settings.json");
      const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) : {};
      const value = JSON.stringify({ ...raw, packages: [] });
      if (fn(value) !== undefined) throw new Error("资源扫描禁止修改 Pi 设置");
    },
  }, { projectTrusted: true });
  // 扩展工具不经 customTools 权限包装；此钩子在外部扩展事件处理器之后检查最终参数。
  // noExtensions 阻止 SDK 默认路径在授权前执行，只有显式列出的已授权入口会加载。
  // loader 构造前最后一次复核实时模式：若创建期间已切离 full，本会话不加载任何扩展。
  const extensionPaths = liveMode() === "full" ? approvedExtensions : [];
  const guardedLoader = new DRL({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager: resourceSettings,
    noExtensions: true,
    additionalExtensionPaths: extensionPaths,
    additionalSkillPaths: packagePaths(installedPackages.skills),
    additionalPromptTemplatePaths: packagePaths(installedPackages.prompts),
    additionalThemePaths: packagePaths(installedPackages.themes),
    extensionFactories: [permissionExtension],
    systemPromptOverride: opts.systemPrompt ? () => opts.systemPrompt! : undefined,
    skillsOverride: (base) => ({
      skills: [...base.skills, ...mergeIntoPiSkills(opts.cwd, base.skills)],
      diagnostics: base.diagnostics,
    }),
  });
  for (const extensionPath of extensionPaths) recordPiExtensionError(extensionPath);
  await clearPiExtensionCache();
  await guardedLoader.reload();
  for (const extension of guardedLoader.getExtensions().extensions) {
    recordPiExtensionStats(extension.resolvedPath, extension.tools.size, extension.commands.size);
  }
  for (const error of guardedLoader.getExtensions().errors) {
    recordPiExtensionError(error.path, error.error);
    opts.onExtensionError?.({ extensionPath: error.path, event: "load", error: error.error });
  }

  const sessionOpts: CreateAgentSessionOptions = {
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    modelRuntime: modelRuntime as any,
    model: opts.model as any,
    thinkingLevel: opts.thinkingLevel,
    settingsManager: settingsMgr as any,
    resourceLoader: guardedLoader,
    sessionManager: sessionManager as any,
    customTools: tools,
    noTools: "builtin",
  };

  const { session } = await createAgentSession(sessionOpts);
  // reload 期间切档的兜底：工厂已在 reload 中执行（单个 await 内无法抢占），但不再把
  // 扩展事件与 UI 绑定进会话；调用方（agent-service 的创建门禁）会弃用此会话按收紧后的模式重建。
  if (extensionPaths.length === 0 || liveMode() === "full") {
    await session.bindExtensions({
      mode: "rpc",
      uiContext: createPiExtensionUi(opts.cwd),
      onError: (error) => {
        recordPiExtensionError(error.extensionPath, error.error);
        opts.onExtensionError?.(error);
        console.error(`[pi-extension] ${error.extensionPath} ${error.event}: ${error.error}`);
      },
    });
  }
  return session;
}

export async function createPiSession(opts: PiSessionOptions): Promise<AgentSession> {
  const SM = await ensureSessionManagerClass();
  const sessionDir = opts.sessionDir ?? getPiSessionDir(opts.cwd);
  const sessionManager = SM.create(opts.cwd, sessionDir);
  return buildSession(opts, sessionManager);
}

export async function resumePiSession(opts: PiSessionOptions): Promise<AgentSession> {
  if (!opts.resumeSessionFile) {
    throw new Error("resumeSessionFile is required for resume");
  }
  const SM = await ensureSessionManagerClass();
  const sessionDir = getPiSessionDir(opts.cwd);
  const sessionManager = SM.open(opts.resumeSessionFile, sessionDir, opts.cwd);
  return buildSession(opts, sessionManager);
}


export async function listPiSessions(cwd: string) {
  const SM = await ensureSessionManagerClass();
  const sessionDir = getPiSessionDir(cwd);
  return SM.list(cwd, sessionDir);
}

const closingSessions = new WeakMap<AgentSession, Promise<void>>();

/** Pi's dispose() is synchronous and does not emit session_shutdown. */
export function disposePiSession(session: AgentSession): Promise<void> {
  const existing = closingSessions.get(session);
  if (existing) return existing;
  const closing = (async () => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (session.extensionRunner.hasHandlers("session_shutdown")) {
        await Promise.race([
          session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }),
          new Promise<void>((resolve) => { timeout = setTimeout(resolve, 2000); }),
        ]);
      }
    } catch (error) {
      console.error("[pi-extension] session_shutdown failed:", error);
    } finally {
      if (timeout) clearTimeout(timeout);
      session.dispose();
    }
  })();
  closingSessions.set(session, closing);
  return closing;
}
