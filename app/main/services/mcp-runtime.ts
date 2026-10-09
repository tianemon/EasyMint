import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, InlineExtension, LoadedMcpConfig, McpHostController, McpHostStatus, McpServerEntry } from "@earendil-works/pi-coding-agent";
import { scanMcpServers, getMcpServerConfig, expandServerConfig, definitionFingerprint, getMcpConfigPath, validateMcpServer, type McpServerConfig, type McpServerStatus } from "./mcp-service";
import { normalizePermissionMode, type PermissionMode } from "./permission/execution-context";
import { ProtectedMcpTransport } from "./mcp-transport";
import { EncryptedMcpAuthBackend } from "./mcp-auth-store";
import { emAgentDir } from "../utils/paths";
import { createPiExtensionUi } from "./pi-extension-ui";

interface SessionMcp {
  manager: object;
  project: string;
  owners: Set<string>;
  mode: () => PermissionMode;
  controller?: McpHostController;
  statuses: McpHostStatus[];
  disposed: boolean;
}
const sessions = new Set<SessionMcp>();
const probeStatuses = new Map<string, McpServerStatus>();
const redact = (value: string) => value.replace(/(authorization|token|secret|key|password|bearer)\s*[:=]\s*\S+/gi, "$1=***");
const scopeKey = (project: string | undefined, name: string) => `${project ? path.resolve(project) : "global"}::${name}`;
type SignInPrompt = Parameters<typeof import("@earendil-works/pi-coding-agent").signInMcpServer>[0]["prompt"];
const signIns = new Map<string, { abort: AbortController; promise: Promise<{ ok: boolean; error?: string }> }>();
// CodeGraph may catch up its index before answering initialize. Explicit user timeouts win.
export function mcpConnectTimeout(name: string, cfg: McpServerConfig): number {
  return cfg.timeout ?? (name === "codegraph" || /^(codegraph|codegraph\.cmd)$/i.test(cfg.command ?? "") ? 30000 : 8000);
}
function accountKey(name: string, projectPath?: string): string {
  const manifest = scanMcpServers(projectPath).find(server => server.name === name);
  const cfg = manifest && getMcpServerConfig(name, { projectPath, scope: manifest.scope });
  return `${emAgentDir()}::${name.replace(/-/g, "_")}::${cfg?.url ?? ""}`;
}

/** Only accept fields supported by EM. Values handed to the transport are already literals.
 * timeout is the legacy millisecond CONNECT timeout; requestTimeoutSeconds is independent. */
export function toPiMcpEntry(name: string, raw: McpServerConfig, source: string): McpServerEntry {
  const valid = validateMcpServer(name, raw);
  if (!valid.ok) throw new Error(valid.error);
  const { cfg, missing } = expandServerConfig(raw);
  if (missing.length) throw new Error(`未设置环境变量：${missing.join(", ")}`);
  const common = { description: cfg.description, exposure: cfg.exposure, toolExposure: cfg.toolExposure, timeout: cfg.requestTimeoutSeconds };
  return {
    name, source, scope: "global",
    config: cfg.type === "stdio"
      ? { ...common, type: "stdio", command: cfg.command!, args: cfg.args, env: cfg.env, cwd: cfg.cwd }
      : { ...common, type: "http", url: cfg.url!, headers: cfg.headers,
          ...(cfg.oauth ? { oauth: { callbackPort: cfg.callbackPort ?? 31173, clientName: "EasyMint" } } : {}) },
  };
}

function configSource(scope: string, project: string): string {
  return scope === "user" ? getMcpConfigPath() : path.join(project, scope === "project" ? ".easymint/mcp.json" : ".mcp.json");
}

export async function createMcpSessionExtensions(options: {
  cwd: string; agentDir: string; owner: string; sessionId: string; manager: object; getMode: () => string | undefined;
}): Promise<InlineExtension[]> {
  const sdk = await import("@earendil-works/pi-coding-agent");
  const record: SessionMcp = { manager: options.manager, project: path.resolve(options.cwd), owners: new Set([options.owner, options.sessionId]),
    mode: () => record.disposed ? "readonly" : normalizePermissionMode(options.getMode()), statuses: [], disposed: false };
  const rawDefinitions = new Map<string, { fingerprint: string; timeout: number }>();
  const configSignature = () => JSON.stringify([record.mode(), scanMcpServers(record.project).map(server => {
    const raw = getMcpServerConfig(server.name, { projectPath: record.project, scope: server.scope });
    return [server.name, server.scope, server.enabled, server.pendingApproval, raw && definitionFingerprint(raw)];
  })]);
  let loadedSignature: string;
  const credentials = new sdk.McpOAuthCredentialStore(
    new EncryptedMcpAuthBackend(path.join(options.agentDir, "mcp-auth-v2.json")),
    path.join(options.agentDir, "mcp-auth-refresh-locks"),
  );
  const loadConfig = (): LoadedMcpConfig => {
    loadedSignature = configSignature();
    const loaded: LoadedMcpConfig = { servers: [], errors: [] };
    rawDefinitions.clear();
    if (record.disposed || record.mode() === "readonly") return loaded;
    const namespaces = new Set<string>();
    for (const manifest of scanMcpServers(record.project)) {
      if (manifest.pendingApproval || !manifest.enabled) continue;
      const raw = getMcpServerConfig(manifest.name, { projectPath: record.project, scope: manifest.scope });
      if (!raw) continue;
      try {
        const entry = toPiMcpEntry(manifest.name, raw, configSource(manifest.scope, record.project));
        const namespace = manifest.name.replace(/-/g, "_");
        if (namespaces.has(namespace)) throw new Error("服务器名称规范化后冲突，请重命名其中一个服务器");
        namespaces.add(namespace);
        rawDefinitions.set(manifest.name, { fingerprint: definitionFingerprint(raw), timeout: mcpConnectTimeout(manifest.name, raw) });
        loaded.servers.push(entry);
      } catch (error) { loaded.errors.push(`${manifest.name}: ${redact((error as Error).message)}`); }
    }
    return loaded;
  };
  const validateCurrent = (name: string) => {
    const manifest = scanMcpServers(record.project).find(server => server.name === name);
    const raw = manifest && getMcpServerConfig(name, { projectPath: record.project, scope: manifest.scope });
    if (!manifest?.enabled || manifest.pendingApproval || !raw || definitionFingerprint(raw) !== rawDefinitions.get(name)?.fingerprint) {
      throw new Error(`MCP 服务器「${name}」的配置或审批已变化`);
    }
  };
  const trustedTools = new Set<string>();
  const mcpFactory = sdk.createMcpExtension({
    loadConfig,
    credentials,
    logPath: path.join(options.agentDir, "mcp.log"),
    connectTimeoutMs: entry => rawDefinitions.get(entry.name)?.timeout ?? 8000,
    createTransport: (entry, cwd, authProvider) => new ProtectedMcpTransport({
      entry, cwd, authProvider, owner: options.sessionId, mode: record.mode,
      validate: () => {
        if (entry.scope === "extension") {
          if (record.mode() !== "full") throw new Error("扩展注册的 MCP 仅在完全访问模式可用");
        } else validateCurrent(entry.name);
      },
    }),
    openUrl: url => { void import("electron").then(({ shell }) => shell.openExternal(url)); },
    onStatus: statuses => {
      const next = statuses.map(status => ({ ...status, error: status.error && redact(status.error) }));
      for (const status of next) {
        const prior = record.statuses.find(item => item.name === status.name);
        if (status.state === "failed" && (prior?.state !== status.state || prior.error !== status.error)) {
          console.warn(`[mcp] ${status.name} 连接失败：${status.error ?? "未知原因"}`);
        }
      }
      record.statuses = next;
    },
    onController: controller => { record.controller = controller; },
    updateConfig: () => { throw new Error("请通过 EasyMint 设置页修改 MCP 配置"); },
  });
  // Track names registered by the trusted factories, rather than trusting arbitrary mcp__ names.
  const wrapFactory = (factory: (pi: ExtensionAPI) => void) => (pi: ExtensionAPI) => {
    const facade = Object.create(pi) as ExtensionAPI;
    facade.registerTool = definition => { trustedTools.add(definition.name); pi.registerTool(definition); };
    factory(facade);
  };
  return [
    { name: "easymint-mcp", hidden: true, factory: pi => {
      sessions.add(record);
      pi.on("before_agent_start", async () => {
        if (loadedSignature !== configSignature()) {
          await record.controller?.reload();
        } else if (!record.disposed && record.mode() !== "readonly") {
          // Retry only failed discovery, keeping successful servers and their tools alive.
          await Promise.allSettled(record.statuses.filter(status => status.state === "failed")
            .map(status => record.controller?.reconnect(status.name)));
        }
      });
      wrapFactory(mcpFactory)(pi);
      pi.on("session_shutdown", () => { record.disposed = true; sessions.delete(record); });
    } },
    { name: "easymint-codemode", hidden: true, factory: wrapFactory(sdk.createCodemodeExtension({ models: false })) },
    { name: "easymint-tool-search", hidden: true, factory: wrapFactory(sdk.createToolSearchExtension()) },
    { name: "easymint-mcp-identity", hidden: true, factory: pi => {
      const restrictReadonly = () => {
        if (record.mode() === "readonly") pi.setActiveTools(pi.getActiveTools().filter(name => !trustedTools.has(name)));
      };
      pi.on("session_start", restrictReadonly);
      pi.on("before_agent_start", restrictReadonly);
      // Public registration provenance can be checked by the permission gate through this set.
      pi.on("tool_call", event => {
        if (!trustedTools.has(event.toolName)) return;
        if (record.disposed || record.mode() === "readonly") return { block: true, reason: "只读模式不启用 MCP 或 codemode" };
      });
    } },
  ];
}

export function getMcpStatus(projectPath?: string): McpServerStatus[] {
  const records = [...sessions].filter(record => !projectPath || record.project === path.resolve(projectPath));
  return scanMcpServers(projectPath).map(manifest => {
    if (!manifest.enabled) return { name: manifest.name, state: "disabled" };
    if (manifest.pendingApproval) return { name: manifest.name, state: "pending", error: "待确认后启用" };
    if (manifest.type === "sse") return { name: manifest.name, state: "failed", error: "旧 HTTP+SSE 已停用，请改用服务端提供的 Streamable HTTP 端点" };
    const raw = getMcpServerConfig(manifest.name, { projectPath, scope: manifest.scope });
    if (raw) {
      try { toPiMcpEntry(manifest.name, raw, "status"); }
      catch (error) { return { name: manifest.name, state: "failed", error: redact((error as Error).message) }; }
    }
    const status = records.flatMap(record => record.statuses).find(status => status.name === manifest.name);
    if (status) return status;
    return probeStatuses.get(scopeKey(projectPath, manifest.name)) ?? { name: manifest.name, state: "idle", error: records.length ? "当前会话未启用 MCP" : undefined };
  });
}

/** Config changes replace Pi connections, without interrupting the agent's response. */
export function reloadMcpTools(): void {
  probeStatuses.clear();
  for (const record of sessions) void record.controller?.reload().catch(error => console.error("[mcp] 配置重载失败", redact(String(error))));
}
export async function closeMcpContexts(owners: readonly string[]): Promise<void> {
  const affected = [...sessions].filter(record => owners.some(owner => record.owners.has(owner)));
  await Promise.all(affected.map(record => record.controller?.reload()));
}
export async function closeAllMcpClients(): Promise<void> {
  const closing = [...sessions];
  for (const record of closing) record.disposed = true;
  for (const pending of signIns.values()) pending.abort.abort();
  await Promise.allSettled([...closing.map(record => record.controller?.close()), ...[...signIns.values()].map(pending => pending.promise)]);
  sessions.clear();
  probeStatuses.clear();
}

export async function disposeMcpSession(manager: object): Promise<void> {
  // Owner aliases are for recursive permission revocation. Ordinary disposal belongs only to
  // this manager instance, even when children or a resumed session share the logical session id.
  const closing = [...sessions].filter(record => record.manager === manager);
  for (const record of closing) { record.disposed = true; sessions.delete(record); }
  await Promise.all(closing.map(record => record.controller?.close()));
}

async function serverAction(name: string, projectPath: string | undefined, action: "reconnect" | "login" | "logout", prompt?: SignInPrompt, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
  const manifest = scanMcpServers(projectPath).find(server => server.name === name);
  if (!manifest) return { ok: false, error: "服务器不存在" };
  if (!manifest.enabled || manifest.pendingApproval) return { ok: false, error: "服务器已停用或尚未确认启用" };
  const records = [...sessions].filter(record => (!projectPath || record.project === path.resolve(projectPath)) && !record.disposed);
  const available = records.filter(record => record.mode() !== "readonly" && record.controller);
  if (records.length && available.length === 0) return { ok: false, error: "只读会话不连接 MCP" };
  try {
    if (available.length) {
      if (action === "login") {
        // One account, one browser flow. Other sessions pick up the encrypted stored token.
        await available[0]!.controller!.login(name, prompt, signal);
        await Promise.all(available.slice(1).map(record => record.controller!.reconnect(name, signal)));
      } else await Promise.all(available.map(record => record.controller![action](name)));
      return { ok: true };
    }
    const cfg = getMcpServerConfig(name, { projectPath, scope: manifest.scope });
    if (!cfg) return { ok: false, error: "服务器定义已不存在" };
    if (action !== "reconnect") {
      const sdk = await import("@earendil-works/pi-coding-agent");
      const entry = toPiMcpEntry(name, cfg, "settings");
      if (!("url" in entry.config) || Object.keys(entry.config.headers ?? {}).some(header => header.toLowerCase() === "authorization")) {
        return { ok: false, error: "该服务器未使用 OAuth" };
      }
      const credentials = new sdk.McpOAuthCredentialStore(
        new EncryptedMcpAuthBackend(path.join(emAgentDir(), "mcp-auth-v2.json")), path.join(emAgentDir(), "mcp-auth-refresh-locks"));
      if (action === "logout") { credentials.remove(name, entry.config.url); return { ok: true }; }
      const ui = createPiExtensionUi(projectPath);
      await sdk.signInMcpServer({ serverUrl: entry.config.url, store: credentials.forServer(name, entry.config.url),
        signal, settings: { callbackPort: entry.config.oauth?.callbackPort, clientName: entry.config.oauth?.clientName }, prompt: prompt ?? {
          showAuthorizationUrl: url => { void import("electron").then(({ shell }) => shell.openExternal(url.href)); },
          promptForRedirectUrl: signal => ui.input("等待浏览器授权；无法自动回调时可粘贴回调 URL", "http://127.0.0.1:.../callback?code=...", { signal }),
        } });
      probeStatuses.delete(scopeKey(projectPath, name));
      return { ok: true };
    }
    const sdk = await import("@earendil-works/pi-coding-agent");
    const result = await probeConnection(name, cfg, projectPath ?? process.cwd(), new sdk.McpOAuthCredentialStore(
      new EncryptedMcpAuthBackend(path.join(emAgentDir(), "mcp-auth-v2.json")), path.join(emAgentDir(), "mcp-auth-refresh-locks")), () => {
        const current = scanMcpServers(projectPath).find(server => server.name === name);
        const definition = current && getMcpServerConfig(name, { projectPath, scope: current.scope });
        if (!current?.enabled || current.pendingApproval || !definition || definitionFingerprint(definition) !== definitionFingerprint(cfg)) throw new Error("MCP 定义或审批已变化");
      });
    // A closed diagnostic connection is a passed test, not a live session connection.
    probeStatuses.set(scopeKey(projectPath, name), { name, state: result.ok ? "idle" : result.state === "needs-auth" ? "needs-auth" : "failed", toolCount: result.toolCount, error: result.error });
    return result;
  } catch (error) { return { ok: false, error: redact((error as Error).message) }; }
}
export const retryMcpServer = (name: string, projectPath?: string) => serverAction(name, projectPath, "reconnect");
export function loginMcpServer(name: string, projectPath?: string): Promise<{ ok: boolean; error?: string }> {
  const key = accountKey(name, projectPath);
  const running = signIns.get(key);
  if (running) return running.promise;
  const abort = new AbortController();
  const ui = createPiExtensionUi(projectPath);
  const promise = serverAction(name, projectPath, "login", {
    showAuthorizationUrl: url => { if (!abort.signal.aborted) void import("electron").then(({ shell }) => shell.openExternal(url.href)); },
    promptForRedirectUrl: signal => ui.input("等待浏览器授权；无法自动回调时可粘贴回调 URL", "http://127.0.0.1:.../callback?code=...", { signal: AbortSignal.any([signal, abort.signal]) }),
  }, abort.signal).finally(() => { signIns.delete(key); });
  signIns.set(key, { abort, promise });
  return promise;
}
export async function logoutMcpServer(name: string, projectPath?: string): Promise<{ ok: boolean; error?: string }> {
  const running = signIns.get(accountKey(name, projectPath));
  running?.abort.abort();
  await running?.promise;
  return serverAction(name, projectPath, "logout");
}

export async function testMcpServer(cfg: McpServerConfig, projectPath = process.cwd()): Promise<{ ok: boolean; error?: string; toolCount?: number }> {
  const sdk = await import("@earendil-works/pi-coding-agent");
  const { InMemoryAuthStorageBackend } = await import("./mcp-test-store");
  return probeConnection("connection-test", cfg, projectPath, new sdk.McpOAuthCredentialStore(new InMemoryAuthStorageBackend()));
}

async function probeConnection(name: string, cfg: McpServerConfig, projectPath: string,
  credentials: import("@earendil-works/pi-coding-agent").McpOAuthCredentialStore, validate?: () => void,
): Promise<{ ok: boolean; error?: string; toolCount?: number; state?: string }> {
  const sdk = await import("@earendil-works/pi-coding-agent");
  let connection: InstanceType<typeof sdk.McpServerConnection> | undefined;
  try {
    const entry = toPiMcpEntry(name, cfg, "test");
    const mode = (): PermissionMode => {
      const records = [...sessions].filter(record => record.project === path.resolve(projectPath) && !record.disposed);
      return records.length && records.every(record => record.mode() === "readonly") ? "readonly" : "standard";
    };
    const owner = `mcp-test-${randomUUID()}`;
    connection = new sdk.McpServerConnection({
      entry, cwd: projectPath, credentials,
      connectTimeoutMs: mcpConnectTimeout(name, cfg), onTools: () => {},
      createTransport: (server, cwd, authProvider) => new ProtectedMcpTransport({ entry: server, cwd, authProvider, owner, mode, validate }),
    });
    await connection.getClient();
    return { ok: true, toolCount: connection.tools.length };
  } catch (error) { return { ok: false, error: redact((error as Error).message), state: connection?.state }; }
  finally { await connection?.close(); }
}
