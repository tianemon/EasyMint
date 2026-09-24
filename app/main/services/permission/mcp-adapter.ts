/**
 * omp MCP 系统 → EM 适配层
 *
 * 封装 omp mcp/ 的完整 MCPManager，提供 EM 所需的 MCP 工具加载能力。
 * 使用 @modelcontextprotocol/sdk 的 transport（替代 omp 自定义 Bun 实现）。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { spawnSync } from "node:child_process";
import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { scanMcpServers, getMcpServerConfig, expandServerConfig } from "../mcp-service";
import { writeMcpInstructions } from "../mcp-instructions";
import type { McpServerConfig, McpServerManifest, McpServerStatus } from "../mcp-service";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { EmOAuthProvider } from "../mcp-oauth";
import { ensureSandbox, isSandboxBypassedForMode, wrapForSandbox } from "../sandbox/manager";
import type { PermissionMode } from "./access-policy";
import { createExecutionContext } from "./execution-context";
import { bindExecutionOwner } from "./execution-context";
import { findBashOnWindows } from "../background-shell/registry";
import {
  INTENT_REQUIREMENT,
  stripIntentParams,
  withIntentParam,
} from "../../../shared/tool-intent";

const clients = new Map<string, Client>();
/** stdio MCP 进程持有的 Windows ACL worker 租约；close 时与进程一起回收。 */
const clientSandboxLeases = new WeakMap<Client, () => Promise<void>>();

async function closeClient(client: Client): Promise<void> {
  try { await client.close(); }
  finally { await clientSandboxLeases.get(client)?.(); clientSandboxLeases.delete(client); }
}
/** 同一会话并发搜索/调用一个 server 时只建立一次连接；完成后不缓存定义，配置变更仍即时生效。 */
const pendingServerLoads = new Map<string, Promise<ToolDefinition[]>>();
/** 项目维度 + server 名 → 连接状态（不同项目的同名 server 状态不串扰） */
const statusMap = new Map<string, McpServerStatus>();
function statusKey(projectPath: string | undefined, name: string): string {
  return (projectPath ? "p:" + projectPath : "global") + "::" + name;
}

function cacheKey(projectPath?: string): string {
  return projectPath ? `p:${projectPath}` : "global";
}

/** 错误信息脱敏（对齐 OMP errors.ts:45——不把密钥写进日志/界面） */
function redact(msg: string): string {
  return msg.replace(/(authorization|token|secret|key|password|bearer)\s*[:=]\s*\S+/gi, "$1=***");
}

/** 连接/拉取超时(ms)——冷启动首连 MCP 时,任一挂起不阻塞发送链路 */
const MCP_CONNECT_TIMEOUT_MS = 8000;
const MCP_LIST_TIMEOUT_MS = 5000;

/** Promise.race 超时包装:MCP 服务器挂起时抛错由调用方跳过,不阻塞工具加载 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} 超时(${ms}ms)`)), ms)),
  ]);
}

/** 检查命令是否存在(Unix: which / command -v; Win: where)。不存在的命令不 spawn,
 *  避免 Windows 下子进程输出 GBK 报错导致日志乱码，避免 Linux 下 command 内建命令导致 ENOENT。 */
function commandExists(command: string, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    if (process.platform === "win32") {
      const probe = spawnSync("where", [command], { stdio: "ignore", timeout: 3000, env });
      return probe.status === 0;
    }
    // Unix: 优先用 which, 若未安装 which 则通过 sh -c "command -v ..." 探测内置/外部命令
    const whichProbe = spawnSync("which", [command], { stdio: "ignore", timeout: 3000, env });
    if (whichProbe.status === 0) return true;
    if (whichProbe.error && (whichProbe.error as NodeJS.ErrnoException).code === "ENOENT") {
      const shProbe = spawnSync("sh", ["-c", `command -v "$1"`, "_", command], { stdio: "ignore", timeout: 3000, env });
      return shProbe.status === 0;
    }
    return false;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function clientKey(name: string, projectPath?: string, mode?: PermissionMode, contextId = "shared"): string {
  return `${cacheKey(projectPath)}::${contextId}::${mode ?? "standard"}::${name}`;
}

async function connect(
  name: string,
  cfg: McpServerConfig,
  execution?: { projectPath: string; mode: PermissionMode; contextId?: string },
  timeoutMs = MCP_CONNECT_TIMEOUT_MS,
): Promise<Client> {
  if (execution?.mode === "readonly") {
    throw new Error("只读模式不启动或连接 MCP");
  }
  const client = new Client(
    { name: "easymint", version: "1.0.0" },
    { capabilities: {} as any },
  );

  if (cfg.type === "stdio") {
    const projectPath = execution?.projectPath ?? process.cwd();
    const mode = execution?.mode ?? "standard";
    const context = bindExecutionOwner(
      createExecutionContext(projectPath, mode, cfg.env as Record<string, string> | undefined),
      execution?.contextId ?? "shared",
    );
    // 命令不存在则不 spawn:避免 Windows 下子进程 GBK 报错 → 日志乱码
    if (cfg.command && !commandExists(cfg.command, context.environment)) {
      throw new Error(`未找到命令 "${cfg.command}"——请检查 MCP 配置,确认已安装`);
    }
    // 完全访问模式不进沙盒——否则 Playwright 这类需要自己 apply 子进程沙盒的 MCP 会恒起不来
    // （Chromium 在已沙盒进程内 `sandbox initialization failed`），见 isSandboxBypassedForMode
    // 关沙盒只换执行后端：wrapForSandbox 两条分支都返回带 env 的规格，一律由它产出执行目标；
    // ensureSandbox 只在真的要用沙盒时才调（否则会白初始化 srt，且初始化失败会误报"MCP 后端不可用"）。
    const sandboxed = !isSandboxBypassedForMode(mode);
    if (sandboxed) {
      const initialized = await ensureSandbox(projectPath, mode);
      if (!initialized.ok) throw new Error(`MCP 安全执行后端不可用：${initialized.reason}`);
    }
    const rawCommand = [cfg.command!, ...(cfg.args ?? [])].map(shellQuote).join(" ");
    const gitBashPath = process.platform === "win32" ? findBashOnWindows() : undefined;
    if (process.platform === "win32" && !gitBashPath) {
      throw new Error("Windows 受保护 MCP 需要 Git Bash。请安装 Git for Windows 后重试。");
    }
    const wrapped = await wrapForSandbox(rawCommand, { context, gitBashPath: gitBashPath ?? undefined });
    const transport = wrapped.kind === "argv"
      ? new StdioClientTransport({ command: wrapped.argv[0]!, args: wrapped.argv.slice(1), env: wrapped.env as Record<string, string>, cwd: projectPath })
      : new StdioClientTransport({ command: "/bin/sh", args: ["-c", wrapped.command], env: wrapped.env as Record<string, string>, cwd: projectPath });
    try {
      await client.connect(transport, { timeout: timeoutMs });
      if (wrapped.release) clientSandboxLeases.set(client, wrapped.release);
    } catch (error) {
      try { await client.close(); } catch { try { await transport.close(); } catch { /* 已退出 */ } }
      await wrapped.release?.();
      throw error;
    }
    return client;
  }

  if (cfg.type === "http" || cfg.type === "sse") {
    // OAuth：配置声明 oauth=true 的 http/sse server 用 SDK 的 authProvider 流程
    // （SDK 自动带 token / 401 时走 provider 刷新与授权），静态 headers 仍可共存
    const wantsOauth = (cfg as { oauth?: boolean }).oauth === true;
    const authProvider = wantsOauth
      ? new EmOAuthProvider(name, cfg.url as string, (cfg as { callbackPort?: number }).callbackPort)
      : undefined;
    const requestInit = cfg.headers ? { headers: cfg.headers } : undefined;
    const transport = cfg.type === "http"
      ? new StreamableHTTPClientTransport(new URL(cfg.url as string), {
          requestInit,
          authProvider: authProvider as any,
        })
      : new SSEClientTransport(new URL(cfg.url as string), {
          requestInit,
          authProvider: authProvider as any,
        });
    try {
      await client.connect(transport, { timeout: timeoutMs });
      return client;
    } catch (e) {
      const msg = (e as Error).message || "";
      const needsAuth = /401|403|unauthorized|unauthorized_error/i.test(msg);
      if (wantsOauth && needsAuth && authProvider) {
        try { await client.close(); } catch { try { await transport.close(); } catch { /* 已关闭 */ } }
        // 完整 OAuth 流程（SDK 驱动）：元数据发现 → DCR（如需）→ 浏览器授权 → 换 token → saveTokens
        console.log(`[mcp-oauth] ${name} 需要 OAuth，发起浏览器授权流程…`);
        await auth(authProvider as any, {
          serverUrl: new URL(cfg.url as string),
          // 授权码等待：provider 内部 loopback 监听（redirectToAuthorization 启动）
          fetchFn: undefined,
        }).catch((oe: Error) => {
          (authProvider as EmOAuthProvider).stopCallbackServer();
          throw new Error(`OAuth 授权未完成：${oe.message}`);
        });
        (authProvider as EmOAuthProvider).stopCallbackServer();
        // 重新连接（此时 provider.tokens() 已有 token，transport 自动带上）。
        // 用新 Client 而非复用——首次 connect 失败后复用同一实例存在内部状态残留风险
        const retryClient = new Client({ name: "easymint", version: "1.0.0" }, { capabilities: {} as any });
        const retry = cfg.type === "http"
          ? new StreamableHTTPClientTransport(new URL(cfg.url as string), { requestInit, authProvider: authProvider as any })
          : new SSEClientTransport(new URL(cfg.url as string), { requestInit, authProvider: authProvider as any });
        try {
          await retryClient.connect(retry, { timeout: timeoutMs });
          return retryClient;
        } catch (retryError) {
          try { await retryClient.close(); } catch { try { await retry.close(); } catch { /* 已关闭 */ } }
          throw retryError;
        }
      }
      try { await client.close(); } catch { try { await transport.close(); } catch { /* 已关闭 */ } }
      throw e;
    }
  }

  throw new Error(`不支持的 MCP 传输类型: ${cfg.type}`);
}

/** 拉取一个 server 的工具（内部用：并发调度 + 状态记录）
 *  参数收完整 manifest（而非只收 name/type）：定义来源必须由**扫描结果自带的 scope** 决定。
 *  漏传 scope 时 getMcpServerConfig 只读用户级 mcp.json → 项目级（EM 项目级 / 项目根 .mcp.json）
 *  的定义恒取不到、一律写成「配置已不存在」，项目级 MCP 就连不上——这是阶段B加 scope 时漏改的调用点。 */
async function loadOneServer(
  s: McpServerManifest,
  defineTool: Awaited<ReturnType<typeof getDefineToolFn>>,
  projectPath?: string,
  getMode: () => PermissionMode = () => "standard",
  contextId = "shared",
): Promise<ToolDefinition[]> {
  // scope 取 manifest 的胜出来源，不按名字猜、不额外让调用方传参：
  // 用户级 > EM 项目级 > 项目根 .mcp.json 的优先级已由 scanMcpServers 定完，这里只照它读同一个文件
  const raw = getMcpServerConfig(s.name, { scope: s.scope, projectPath });
  if (!raw) {
    statusMap.set(statusKey(projectPath, s.name), { name: s.name, state: "failed", error: "配置已不存在" });
    return [];
  }
  // 变量展开（${VAR} / ${VAR:-default}）——未定义的变量保留原样并提示
  const { cfg, missing } = expandServerConfig(raw);
  if (missing.length > 0) {
    console.warn(`[mcp] ${s.name} 未设置的环境变量: ${missing.join(", ")}`);
  }
  statusMap.set(statusKey(projectPath, s.name), { name: s.name, state: "connecting" });

  const initialMode = getMode();
  const initialKey = clientKey(s.name, projectPath, initialMode, contextId);
  let client = clients.get(initialKey);
  if (!client) {
    try {
      // 超时保护:冷启动首连挂起的 MCP 直接跳过,不让工具加载阻塞发送链路
      const timeout = raw.timeout || MCP_CONNECT_TIMEOUT_MS;
      client = await connect(s.name, cfg, { projectPath: projectPath ?? process.cwd(), mode: initialMode, contextId }, timeout);
      clients.set(initialKey, client);
    } catch (e) {
      const msg = redact((e as Error).message);
      console.warn(`[mcp] ${s.name} 连接失败/超时:`, msg);
      statusMap.set(statusKey(projectPath, s.name), { name: s.name, state: "failed", error: msg });
      return [];
    }
  }
  // 协议自述（initialize 的 instructions，「本 server 能做什么」）：只在连接之后才拿得到，
  // 而搜索入口的工具说明在会话创建时就拼好了 → 存下来给下一次会话用（见 mcp-instructions）。
  // 读失败不阻塞工具加载：自述是纯增益，拿不到就按"这个 server 没写"处理。
  try {
    const instructions = client.getInstructions();
    if (instructions?.trim()) writeMcpInstructions(s.name, raw, projectPath, instructions);
  } catch { /* 自述读取失败不影响工具加载 */ }
  try {
    const response = await withTimeout(client.listTools(), MCP_LIST_TIMEOUT_MS, `MCP ${s.name} listTools`);
    const tools: ToolDefinition[] = [];
    for (const t of response.tools) {
      // snippet 取描述首行(截断 80 字符),让 MCP 工具出现在提示词 Available tools 清单
      const desc = t.description || `MCP 工具: ${s.name}/${t.name}`;
      const snippet = (desc.split("\n")[0] ?? "").slice(0, 80);
      tools.push(defineTool({
        name: `mcp__${s.name}__${t.name}`,
        label: `MCP: ${s.name}/${t.name}`,
        // 末尾追加"必须填 _intent"的要求——与 bash 工具的写法一致（tool.ts），
        // 让模型每次调用都填一句中文意图，聊天页不展开也能看出这次在做什么
        description: `${desc}\n${INTENT_REQUIREMENT}`,
        promptSnippet: snippet,
        // schema 是 server 给的，但**交给模型看的那份由我们拼** → 加一个仅用于展示的 _intent 字段；
        // 转发给 server 前会剥掉（见下方 execute），server 永远看不到它
        parameters: withIntentParam(t.inputSchema || { type: "object" as const, properties: {} }),
        async execute(_tid: any, params: any, _sig: any, _upd: any, _ctx: any) {
          const mode = getMode();
          const key = clientKey(s.name, projectPath, mode, contextId);
          let activeClient = clients.get(key);
          if (!activeClient) {
            // 权限模式切换后先关闭同一会话的旧模式进程，撤销它仍持有的 OS 权限。
            const contextPrefix = `${cacheKey(projectPath)}::${contextId}::`;
            for (const [oldKey, oldClient] of clients) {
              if (!oldKey.startsWith(contextPrefix) || !oldKey.endsWith(`::${s.name}`)) continue;
              clients.delete(oldKey);
              try { await closeClient(oldClient); } catch { /* 已断开的旧连接无需阻塞新模式 */ }
            }
            activeClient = await connect(
              s.name,
              cfg,
              { projectPath: projectPath ?? process.cwd(), mode, contextId },
              raw.timeout || MCP_CONNECT_TIMEOUT_MS,
            );
            clients.set(key, activeClient);
          }
          // 剥掉 _intent 再发给 server：那是 EM 自己加给模型看的展示字段，
          // 严格的 server 会因未知参数报错（甚至拒绝整次调用）
          const args = stripIntentParams(params) as Record<string, unknown>;
          const result = await activeClient.callTool({ name: t.name, arguments: args });
          const content = result.content as any;
          const text = Array.isArray(content) ? content.map((c: any) => c.text || "").join("\n") : String(content || "");
          return { content: [{ type: "text" as const, text: text || "(无输出)" }], details: {} };
        },
      }) as any as ToolDefinition);
    }
    statusMap.set(statusKey(projectPath, s.name), { name: s.name, state: "connected", toolCount: tools.length });
    return tools;
  } catch (e) {
    const msg = redact((e as Error).message);
    console.warn(`[mcp] ${s.name} listTools 失败:`, msg);
    statusMap.set(statusKey(projectPath, s.name), { name: s.name, state: "failed", error: msg });
    return [];
  }
}

/**
 * 全量加载：一次扫描并连接**所有**已启用的 server，返回全部 MCP 工具定义。
 *
 * ⚠️ 生产路径已不再调用它——会话创建改走按需入口（`mcp-broker` 的 search/call），
 * 免得普通对话为了"发现工具"就把全部 server 连上。保留的原因：它是唯一"一次拿全"的能力，
 * 现有测试仍依赖它；将来若要给 broker 加降级路径也会回到这里。
 * 新增调用点前想清楚：这一步会拉起所有 MCP 子进程。
 */
export async function loadMcpTools(projectPath?: string, getMode?: () => PermissionMode, contextId = "shared"): Promise<ToolDefinition[]> {
  // 防御式门禁：调用方即使误调用，也不能在只读模式下扫描后连接 MCP。
  if (getMode?.() === "readonly") return [];
  const defineTool = await getDefineToolFn();
  const servers = scanMcpServers(projectPath);

  // 并发连接（对齐 OMP 的 Promise.allSettled）——串行时 server 多会拖慢首条消息
  const tasks = servers.map(async (s) => {
    if (!s.enabled) {
      statusMap.set(statusKey(projectPath, s.name), { name: s.name, state: "disabled" });
      return [];
    }
    // 项目级（含只读兼容来源）首次使用需确认——CC 的 Pending approval 设计
    if (s.pendingApproval) {
      statusMap.set(statusKey(projectPath, s.name), { name: s.name, state: "pending" as McpServerStatus["state"], error: "待确认后启用" });
      return [];
    }
    try {
      return await loadOneServer(s, defineTool, projectPath, getMode, contextId);
    } catch (e) {
      const msg = redact((e as Error).message);
      statusMap.set(statusKey(projectPath, s.name), { name: s.name, state: "failed", error: msg });
      return [];
    }
  });
  const settled = await Promise.allSettled(tasks);
  const tools: ToolDefinition[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") tools.push(...r.value);
  }
  return tools;
}

/** 按需读取单个 server 的工具；搜索/调用入口不应为了一个 server 拉起全部 MCP。 */
export async function loadMcpServerTools(
  name: string,
  projectPath?: string,
  getMode: () => PermissionMode = () => "standard",
  contextId = "shared",
): Promise<ToolDefinition[]> {
  if (getMode() === "readonly") throw new Error("只读模式不连接 MCP");
  const manifest = scanMcpServers(projectPath).find((server) => server.name === name);
  if (!manifest) throw new Error(`未找到 MCP 服务器「${name}」`);
  if (!manifest.enabled) throw new Error(`MCP 服务器「${name}」已停用`);
  if (manifest.pendingApproval) throw new Error(`MCP 服务器「${name}」尚未确认启用`);
  const originalDefinition = getMcpServerConfig(name, { scope: manifest.scope, projectPath });
  if (!originalDefinition) throw new Error(`MCP 服务器「${name}」的定义已不存在`);
  const initialMode = getMode();
  const key = clientKey(name, projectPath, initialMode, contextId);
  const running = pendingServerLoads.get(key);
  if (running) return running;
  const pending = (async () => {
    const defineTool = await getDefineToolFn();
    const tools = await loadOneServer(manifest, defineTool, projectPath, getMode, contextId);
    if (getMode() !== initialMode) {
      await closeMcpContexts([contextId]);
      throw new Error("权限模式已变化，请重新搜索 MCP 工具");
    }
    const current = scanMcpServers(projectPath).find((server) => server.name === name);
    const currentDefinition = current && getMcpServerConfig(name, { scope: current.scope, projectPath });
    if (!current?.enabled || current.pendingApproval || JSON.stringify(currentDefinition) !== JSON.stringify(originalDefinition)) {
      await closeMcpContexts([contextId]);
      throw new Error(`MCP 服务器「${name}」的定义已变化，请重新搜索`);
    }
    const status = statusMap.get(statusKey(projectPath, name));
    if (tools.length === 0 && status?.state === "failed") throw new Error(status.error || `MCP 服务器「${name}」连接失败`);
    return tools;
  })();
  pendingServerLoads.set(key, pending);
  try { return await pending; }
  finally { if (pendingServerLoads.get(key) === pending) pendingServerLoads.delete(key); }
}

/** 获取各 server 连接状态（界面状态列与诊断）。
 *  查找顺序：项目键 → 全局键——prewarm 以无项目路径连接（状态记全局键），
 *  界面按项目路径查询时若会话尚未加载过，回落全局，避免永远显示「连接中」 */
export function getMcpStatus(projectPath?: string): McpServerStatus[] {
  return scanMcpServers(projectPath).map((s) => {
    if (!s.enabled) return { name: s.name, state: "disabled" as const };
    if (s.pendingApproval) return { name: s.name, state: "pending" as McpServerStatus["state"], error: "待确认后启用" };
    return statusMap.get(statusKey(projectPath, s.name))
      ?? statusMap.get(statusKey(undefined, s.name))
      ?? { name: s.name, state: "connecting" as const };
  });
}

/** 界面查询状态时：对启用但尚无任何状态记录的 server 发起后台连接探测
 *  （fire-and-forget，结果写回 statusMap；已有状态（含失败）的不重复探测，失败走界面「重试」） */
const probing = new Set<string>();
export function ensureStatusProbe(projectPath?: string): void {
  for (const s of scanMcpServers(projectPath)) {
    if (!s.enabled || s.pendingApproval) continue;
    const key = statusKey(projectPath, s.name);
    if (statusMap.has(key) || probing.has(key)) continue;
    probing.add(key);
    void (async () => {
      try {
        const defineTool = await getDefineToolFn();
        await loadOneServer(s, defineTool, projectPath);
      } catch (e) {
        console.warn(`[mcp] ${s.name} 状态探测异常:`, redact((e as Error).message));
      } finally {
        probing.delete(key);
      }
    })();
  }
}

/** 配置变更后丢弃在途的按需加载。
 *  工具定义本来就不缓存（每次从当前配置重新扫描），所以这里只需断开"正在进行中"的那几个；
 *  client 的丢弃走 dropMcpClient——不要靠这个函数去让已建立的连接失效。 */
export function reloadMcpTools(): void {
  pendingServerLoads.clear();
}

/** 丢弃指定 server 的已建连接与状态记录（保存/删除/开关后调用）。
 *  必要性：clients 按名复用连接——改配置（如换/清 PAT）不丢弃会一直用旧连接，
 *  实测：删除 github 后不填令牌重加，状态仍显示「连接成功」。 */
export async function dropMcpClient(name: string): Promise<void> {
  for (const key of pendingServerLoads.keys()) if (key.endsWith(`::${name}`)) pendingServerLoads.delete(key);
  const dropped: Client[] = [];
  for (const [key, client] of clients) {
    if (!key.endsWith(`::${name}`)) continue;
    clients.delete(key);
    dropped.push(client);
  }
  for (const key of [...statusMap.keys()]) {
    if (key.endsWith("::" + name)) statusMap.delete(key);
  }
  for (const client of dropped) {
    try {
      await closeClient(client);
    } catch (e) {
      console.warn(`[mcp] ${name} 旧连接关闭失败（忽略）:`, redact((e as Error).message));
    }
  }
}

/** 权限降级时立即关闭会话持有的本地 MCP 进程，不能等到下一次工具调用才撤销旧权限。 */
export async function closeMcpContexts(contextIds: readonly string[]): Promise<void> {
  const ids = new Set(contextIds.filter(Boolean));
  if (ids.size === 0) return;
  const dropped: Client[] = [];
  for (const [key, client] of clients) {
    const parts = key.split("::");
    if (!ids.has(parts[1] || "")) continue;
    clients.delete(key);
    dropped.push(client);
  }
  await Promise.allSettled(dropped.map((client) => closeClient(client)));
}

/**
 * 应用退出：关闭全部 MCP 客户端（含本地 stdio 进程）。
 *
 * 为什么单独有这一条：stdio MCP server（如 `codegraph serve --mcp`、`npx @playwright/mcp`）
 * 是 EM spawn 的**常驻**子进程，生命周期本就该跟着 EM 走。退出时不关，它们会继续活着——
 * 白占内存/端口，且会被 macOS 26+ 归因为「应用退出后仍活跃的后台任务」。
 * （配置变更走 dropMcpClient、权限降级走 closeMcpContexts，两者都不是退出路径。）
 * 由 index.ts 的退出清场 await；单个客户端关闭失败不影响其它（allSettled）。
 */
export async function closeAllMcpClients(): Promise<void> {
  const dropped = [...clients.values()];
  clients.clear();
  statusMap.clear();
  pendingServerLoads.clear();
  await Promise.allSettled(dropped.map((client) => closeClient(client)));
}

/** 单个 server 重试：断开旧连接并清缓存，立即重连一次（界面「重试连接」） */
export async function retryMcpServer(name: string, projectPath?: string): Promise<{ ok: boolean; error?: string }> {
  await dropMcpClient(name);
  const s = scanMcpServers(projectPath).find((x) => x.name === name);
  if (!s) return { ok: false, error: `未找到服务器「${name}」` };
  if (!s.enabled) return { ok: false, error: "服务器已停用，请先启用" };
  // 门卫必须在适配器层：待确认的项目级 server 一律不拉起（loadOneServer 会 spawn 子进程）。
  // 界面现在不给待确认行重试按钮，但 UI 会变，不能只靠 UI 不放入口。
  if (s.pendingApproval) return { ok: false, error: `服务器「${name}」尚未确认启用——请先在 MCP 列表中确认` };
  const defineTool = await getDefineToolFn();
  // 重连即生效：连接与 statusMap 在这里刷新；工具定义不缓存（按需入口每次从当前配置取），
  // 所以不需要往任何缓存里回写
  await loadOneServer(s, defineTool, projectPath);
  const st = statusMap.get(statusKey(projectPath, name));
  return st?.state === "connected" ? { ok: true } : { ok: false, error: st?.error || "连接失败" };
}

/** 测试配置能否连通（不写入配置、不影响缓存——界面「测试连接」） */
export async function testMcpServer(cfg: McpServerConfig): Promise<{ ok: boolean; error?: string; toolCount?: number }> {
  const v = cfg.type === "stdio" ? !cfg.command?.trim() : !cfg.url?.trim();
  if (v) return { ok: false, error: cfg.type === "stdio" ? "缺少启动命令" : "缺少 URL" };
  let client: Client | null = null;
  try {
    const { cfg: expanded } = expandServerConfig(cfg);
    client = await connect("__test__", expanded, undefined, cfg.timeout || MCP_CONNECT_TIMEOUT_MS);
    const res = await withTimeout(client.listTools(), MCP_LIST_TIMEOUT_MS, "MCP 测试 listTools");
    return { ok: true, toolCount: res.tools.length };
  } catch (e) {
    return { ok: false, error: redact((e as Error).message) };
  } finally {
    if (client) { try { await closeClient(client); } catch { /* ignore */ } }
  }
}
