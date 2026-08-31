/**
 * omp MCP 系统 → EM 适配层
 *
 * 封装 omp mcp/ 的完整 MCPManager，提供 EM 所需的 loadMcpTools() 接口。
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
import type { McpServerConfig, McpServerStatus } from "../mcp-service";

const clients = new Map<string, Client>();
/** 工具缓存按项目分键——多项目切换时项目级 MCP 不串台（原全局单缓存会在 B 项目看到 A 项目的工具） */
const toolsCache = new Map<string, ToolDefinition[]>();
/** server 名 → 连接状态（界面状态列/诊断） */
const statusMap = new Map<string, McpServerStatus>();

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

/** Promise.race 超时包装:MCP 服务器挂起时抛错由调用方跳过,不阻塞 loadMcpTools */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} 超时(${ms}ms)`)), ms)),
  ]);
}

/** 检查命令是否存在(unix: command -v / win: where)。不存在的命令不 spawn,
 *  避免 Windows 下子进程输出 GBK 报错导致日志乱码。 */
function commandExists(command: string): boolean {
  try {
    const probe = spawnSync(
      process.platform === "win32" ? "where" : "command",
      process.platform === "win32" ? [command] : ["-v", command],
      { stdio: "ignore", timeout: 3000 },
    );
    return probe.status === 0;
  } catch {
    return false;
  }
}

async function connect(name: string, cfg: McpServerConfig): Promise<Client> {
  const client = new Client(
    { name: "easymint", version: "1.0.0" },
    { capabilities: {} as any },
  );

  if (cfg.type === "stdio") {
    // 命令不存在则不 spawn:避免 Windows 下子进程 GBK 报错 → 日志乱码
    if (cfg.command && !commandExists(cfg.command)) {
      throw new Error(`未找到命令 "${cfg.command}"——请检查 MCP 配置,确认已安装`);
    }
    const transport = new StdioClientTransport({
      command: cfg.command!,
      args: cfg.args,
      env: cfg.env as Record<string, string> | undefined,
    });
    await client.connect(transport);
    return client;
  }

  if (cfg.type === "http") {
    const transport = new StreamableHTTPClientTransport(new URL(cfg.url as string), {
      requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
    });
    await client.connect(transport);
    return client;
  }

  if (cfg.type === "sse") {
    const transport = new SSEClientTransport(new URL(cfg.url!));
    await client.connect(transport);
    return client;
  }

  throw new Error(`不支持的 MCP 传输类型: ${cfg.type}`);
}

/** 拉取一个 server 的工具（内部用：并发调度 + 状态记录） */
async function loadOneServer(
  s: { name: string; type: McpServerConfig["type"] },
  defineTool: Awaited<ReturnType<typeof getDefineToolFn>>,
): Promise<ToolDefinition[]> {
  const raw = getMcpServerConfig(s.name);
  if (!raw) {
    statusMap.set(s.name, { name: s.name, state: "failed", error: "配置已不存在" });
    return [];
  }
  // 变量展开（${VAR} / ${VAR:-default}）——未定义的变量保留原样并提示
  const { cfg, missing } = expandServerConfig(raw);
  if (missing.length > 0) {
    console.warn(`[mcp] ${s.name} 未设置的环境变量: ${missing.join(", ")}`);
  }
  statusMap.set(s.name, { name: s.name, state: "connecting" });

  let client = clients.get(s.name);
  if (!client) {
    try {
      // 超时保护:冷启动首连挂起的 MCP 直接跳过,不让 loadMcpTools 阻塞发送链路
      const timeout = raw.timeout || MCP_CONNECT_TIMEOUT_MS;
      client = await withTimeout(connect(s.name, cfg), timeout, `MCP ${s.name} 连接`);
      clients.set(s.name, client);
    } catch (e) {
      const msg = redact((e as Error).message);
      console.warn(`[mcp] ${s.name} 连接失败/超时:`, msg);
      statusMap.set(s.name, { name: s.name, state: "failed", error: msg });
      return [];
    }
  }
  try {
    const response = await withTimeout(client.listTools(), MCP_LIST_TIMEOUT_MS, `MCP ${s.name} listTools`);
    const tools: ToolDefinition[] = [];
    for (const t of response.tools) {
      // snippet 取描述首行(截断 80 字符),让 MCP 工具出现在提示词 Available tools 清单
      const desc = t.description || `MCP 工具: ${s.name}/${t.name}`;
      const snippet = desc.split("\n")[0].slice(0, 80);
      tools.push(defineTool({
        name: `mcp__${s.name}__${t.name}`,
        label: `MCP: ${s.name}/${t.name}`,
        description: desc,
        promptSnippet: snippet,
        parameters: t.inputSchema || { type: "object" as const, properties: {} },
        async execute(_tid: any, params: any, _sig: any, _upd: any, _ctx: any) {
          const result = await client!.callTool({ name: t.name, arguments: params as Record<string, unknown> });
          const content = result.content as any;
          const text = Array.isArray(content) ? content.map((c: any) => c.text || "").join("\n") : String(content || "");
          return { content: [{ type: "text" as const, text: text || "(无输出)" }], details: {} };
        },
      }) as any as ToolDefinition);
    }
    statusMap.set(s.name, { name: s.name, state: "connected", toolCount: tools.length });
    return tools;
  } catch (e) {
    const msg = redact((e as Error).message);
    console.warn(`[mcp] ${s.name} listTools 失败:`, msg);
    statusMap.set(s.name, { name: s.name, state: "failed", error: msg });
    return [];
  }
}

export async function loadMcpTools(projectPath?: string): Promise<ToolDefinition[]> {
  // 工具列表不变，缓存避免重复扫描（按项目分键）
  const key = cacheKey(projectPath);
  const cached = toolsCache.get(key);
  if (cached) return cached;
  // 注意:空结果不缓存(不入 map)——某次全部连接失败时若缓存了 [],
  // 后续所有会话都拿不到 MCP 工具直到重启;失败应下次重试

  const defineTool = await getDefineToolFn();
  const servers = scanMcpServers(projectPath);

  // 并发连接（对齐 OMP 的 Promise.allSettled）——串行时 server 多会拖慢首条消息
  const tasks = servers.map(async (s) => {
    if (!s.enabled) {
      statusMap.set(s.name, { name: s.name, state: "disabled" });
      return [];
    }
    // 项目级（含只读兼容来源）首次使用需确认——CC 的 Pending approval 设计
    if (s.pendingApproval) {
      statusMap.set(s.name, { name: s.name, state: "pending" as McpServerStatus["state"], error: "待确认后启用" });
      return [];
    }
    try {
      return await loadOneServer(s, defineTool);
    } catch (e) {
      const msg = redact((e as Error).message);
      statusMap.set(s.name, { name: s.name, state: "failed", error: msg });
      return [];
    }
  });
  const settled = await Promise.allSettled(tasks);
  const tools: ToolDefinition[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") tools.push(...r.value);
  }

  if (tools.length > 0) toolsCache.set(key, tools);
  return tools;
}

/** 获取各 server 连接状态（界面状态列与诊断） */
export function getMcpStatus(projectPath?: string): McpServerStatus[] {
  return scanMcpServers(projectPath).map((s) => {
    if (!s.enabled) return { name: s.name, state: "disabled" as const };
    return statusMap.get(s.name) ?? { name: s.name, state: "connecting" as const };
  });
}

/** 配置变更后调用：清工具缓存（保留已建立的连接复用），下次发消息重新拉工具——免重启生效 */
export function reloadMcpTools(): void {
  toolsCache.clear();
}

/** 单个 server 重试：断开旧连接并清缓存，立即重连一次（界面「重试连接」） */
export async function retryMcpServer(name: string, projectPath?: string): Promise<{ ok: boolean; error?: string }> {
  const old = clients.get(name);
  if (old) {
    clients.delete(name);
    try { await old.close(); } catch { /* 关闭失败忽略——连接可能已断开 */ }
  }
  const key = cacheKey(projectPath);
  const prev = toolsCache.get(key);
  toolsCache.delete(key);
  const s = scanMcpServers(projectPath).find((x) => x.name === name);
  if (!s) return { ok: false, error: `未找到服务器「${name}」` };
  if (!s.enabled) return { ok: false, error: "服务器已停用，请先启用" };
  const defineTool = await getDefineToolFn();
  const tools = await loadOneServer(s, defineTool);
  // 合并回缓存：其他 server 的工具仍有效时保留（替换掉该 server 的旧工具）
  const prefix = `mcp__${name}__`;
  const others = (prev ?? []).filter((t: ToolDefinition) => !t.name.startsWith(prefix));
  const merged = [...others, ...tools];
  if (merged.length > 0) toolsCache.set(key, merged);
  const st = statusMap.get(name);
  return st?.state === "connected" ? { ok: true } : { ok: false, error: st?.error || "连接失败" };
}

/** 测试配置能否连通（不写入配置、不影响缓存——界面「测试连接」） */
export async function testMcpServer(cfg: McpServerConfig): Promise<{ ok: boolean; error?: string; toolCount?: number }> {
  const v = cfg.type === "stdio" ? !cfg.command?.trim() : !cfg.url?.trim();
  if (v) return { ok: false, error: cfg.type === "stdio" ? "缺少启动命令" : "缺少 URL" };
  let client: Client | null = null;
  try {
    const { cfg: expanded } = expandServerConfig(cfg);
    client = await withTimeout(connect("__test__", expanded), cfg.timeout || MCP_CONNECT_TIMEOUT_MS, "MCP 测试连接");
    const res = await withTimeout(client.listTools(), MCP_LIST_TIMEOUT_MS, "MCP 测试 listTools");
    return { ok: true, toolCount: res.tools.length };
  } catch (e) {
    return { ok: false, error: redact((e as Error).message) };
  } finally {
    if (client) { try { await client.close(); } catch { /* ignore */ } }
  }
}
