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
import { scanMcpServers } from "../mcp-service";
import type { McpServerConfig } from "../mcp-service";

const clients = new Map<string, Client>();
let toolsCache: ToolDefinition[] | null = null;

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
      { stdio: "ignore", shell: true, timeout: 3000 },
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

export async function loadMcpTools(): Promise<ToolDefinition[]> {
  // 工具列表不变，缓存避免重复扫描
  if (toolsCache) return toolsCache;

  const defineTool = await getDefineToolFn();
  const servers = scanMcpServers();
  const tools: ToolDefinition[] = [];

  for (const s of servers) {
    if (!s.enabled) continue;
    const cfg: McpServerConfig = { type: s.type, command: s.command, args: s.args, url: s.url };
    let client = clients.get(s.name);
    if (!client) {
      try {
        // 超时保护:冷启动首连挂起的 MCP 直接跳过,不让 loadMcpTools 阻塞发送链路
        client = await withTimeout(connect(s.name, cfg), MCP_CONNECT_TIMEOUT_MS, `MCP ${s.name} 连接`);
        clients.set(s.name, client);
      } catch (e) { console.warn(`[mcp] ${s.name} 连接失败/超时:`, (e as Error).message); continue; }
    }
    try {
      const response = await withTimeout(client.listTools(), MCP_LIST_TIMEOUT_MS, `MCP ${s.name} listTools`);
      for (const t of response.tools) {
        tools.push(defineTool({
          name: `mcp__${s.name}__${t.name}`,
          label: `MCP: ${s.name}/${t.name}`,
          description: t.description || `MCP 工具: ${s.name}/${t.name}`,
          parameters: t.inputSchema || { type: "object" as const, properties: {} },
          async execute(_tid: any, params: any, _sig: any, _upd: any, _ctx: any) {
            const result = await client!.callTool({ name: t.name, arguments: params as Record<string, unknown> });
            const content = result.content as any;
            const text = Array.isArray(content) ? content.map((c: any) => c.text || "").join("\n") : String(content || "");
            return { content: [{ type: "text" as const, text: text || "(无输出)" }], details: {} };
          },
        }) as any as ToolDefinition);
      }
      console.log(`[mcp] ${s.name}: ${response.tools.length} tools`);
    } catch (e) { console.warn(`[mcp] ${s.name} listTools 失败:`, (e as Error).message); }
  }

  toolsCache = tools;
  return tools;
}
