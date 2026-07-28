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
import type { ToolDefinition } from "../../pi-sdk";
import { getDefineToolFn } from "../../pi-sdk";
import { scanMcpServers } from "../../mcp-service";
import type { McpServerConfig } from "../../mcp-service";

const clients = new Map<string, Client>();
let toolsCache: ToolDefinition[] | null = null;

async function connect(name: string, cfg: McpServerConfig): Promise<Client> {
  const client = new Client(
    { name: "easymint", version: "1.0.0" },
    { capabilities: {} as any },
  );

  if (cfg.type === "stdio") {
    const transport = new StdioClientTransport({
      command: cfg.command!,
      args: cfg.args,
      env: cfg.env as Record<string, string> | undefined,
    });
    await client.connect(transport);
    return client;
  }

  if (cfg.type === "http") {
    const transport = new StreamableHTTPClientTransport(cfg.url!, {
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
      try { client = await connect(s.name, cfg); clients.set(s.name, client); }
      catch (e) { console.warn(`[mcp] ${s.name} 连接失败:`, (e as Error).message); continue; }
    }
    try {
      const response = await client.listTools();
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
            return { content: [{ type: "text" as const, text: text || "(无输出)" }] };
          },
        }) as any as ToolDefinition);
      }
      console.log(`[mcp] ${s.name}: ${response.tools.length} tools`);
    } catch (e) { console.warn(`[mcp] ${s.name} listTools 失败:`, (e as Error).message); }
  }

  toolsCache = tools;
  return tools;
}
