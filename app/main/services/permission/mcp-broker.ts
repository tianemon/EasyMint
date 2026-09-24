/** MCP 工具目录：把完整 schema 留到模型明确搜索时，首轮只暴露两个稳定入口。 */
import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { scanMcpServers, type McpServerManifest } from "../mcp-service";
import { loadMcpServerTools } from "./mcp-adapter";
import { wrapToolWithPermission, type ToolWrapOptions } from "./wrap-tool";
import type { PermissionMode } from "./access-policy";

type BrokerTool = ToolDefinition & { execute: (...args: any[]) => Promise<any> };
const BROKER_NAMES = new Set(["search_mcp_tools", "call_mcp_tool"]);

/** SDK 恢复旧会话时只启用历史里曾有的工具，需把新入口补回活跃集合。 */
export function ensureMcpBrokerActive(session: Pick<import("../pi-sdk").AgentSession, "getAllTools" | "getActiveToolNames" | "setActiveToolsByName">): void {
  const active = session.getActiveToolNames();
  const additions = session.getAllTools()
    .map((tool) => tool.name)
    .filter((name) => BROKER_NAMES.has(name) && !active.includes(name));
  if (additions.length > 0) session.setActiveToolsByName([...active, ...additions]);
}

/** 可用 server 来自当前扫描结果，不能从模型提交的名字直接拼路径或命令。 */
function availableServers(projectPath: string): McpServerManifest[] {
  return scanMcpServers(projectPath).filter((server) => server.enabled && !server.pendingApproval);
}

/** 配置里的 name/description 会**进模型提示词**，而项目根 .mcp.json 是只读兼容来源——
 *  内容可能来自克隆下来的第三方仓库，且 `saveMcpServer` 的校验管不到手改/外部写入的文件。
 *  落进提示词前一律压平空白（去掉换行/控制字符）并限长，别让它被当成多行指令注入。 */
function sanitizeForPrompt(text: string, maxLen: number): string {
  const flat = text.replace(/[\s\u0000-\u001f\u007f]+/g, " ").trim();
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat;
}

/** 给模型看的服务器清单：配上配置里的用途说明，让它在"该不该找外部能力"这一步就能判断。
 *  没填用途就只露名字——不补占位词，免得模型把占位当成真实能力。 */
function describeServers(servers: McpServerManifest[]): string {
  return servers
    .map((s) => {
      const name = sanitizeForPrompt(s.name, 64);
      const desc = s.description ? sanitizeForPrompt(s.description, 40) : "";
      return desc ? `${name}（${desc}）` : name;
    })
    .join("、");
}

export async function createMcpBrokerTools(
  projectPath: string,
  contextId: string,
  getMode: () => PermissionMode,
  canUseTool: ToolWrapOptions["canUseTool"],
): Promise<ToolDefinition[]> {
  const defineTool = await getDefineToolFn();
  const servers = availableServers(projectPath);
  const search = defineTool({
    name: "search_mcp_tools",
    label: "查找 MCP 工具",
    description: `按需查找 MCP 工具。可用服务器：${describeServers(servers) || "无"}。任务需要上述外部能力时先查一次，再用 call_mcp_tool 调用；不要猜工具参数。只读模式下不可用。`,
    promptSnippet: "按服务器和用途查找 MCP 工具及参数；只在需要外部能力时调用",
    parameters: {
      type: "object" as const,
      properties: {
        server: { type: "string" as const, description: "MCP 服务器名；省略时只列出可用服务器" },
        query: { type: "string" as const, description: "用途或工具名关键词；指定 server 后可省略" },
        limit: { type: "number" as const, description: "最多返回多少个工具，默认 5、上限 8" },
      },
    },
    async execute(_id: string, params: { server?: string; query?: string; limit?: number }) {
      if (getMode() === "readonly") throw new Error("只读模式不可使用 MCP");
      const current = availableServers(projectPath);
      const server = params.server ?? current.find((s) => params.query?.toLowerCase().includes(s.name.toLowerCase()))?.name;
      if (!server) return { content: [{ type: "text" as const, text: JSON.stringify({ servers: current.map((s) => s.name) }) }], details: {} };
      if (!current.some((s) => s.name === server)) throw new Error(`服务器「${server}」不可用或尚未确认启用`);
      const tools = await loadMcpServerTools(server, projectPath, getMode, contextId);
      const query = params.query?.trim().toLowerCase() ?? "";
      const words = query.split(/\s+/).filter(Boolean);
      const ranked = tools.map((tool) => ({
        tool,
        score: words.reduce((score, word) => score + (tool.name.toLowerCase().includes(word) ? 3 : 0)
          + (tool.description.toLowerCase().includes(word) ? 1 : 0), 0),
      })).sort((a, b) => b.score - a.score);
      const limit = Number.isFinite(params.limit) ? Math.max(1, Math.min(8, Math.floor(params.limit!))) : 5;
      const selected = ranked.slice(0, limit).map(({ tool }) => ({
        name: tool.name, description: tool.description, parameters: tool.parameters,
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ server, total: tools.length, tools: selected }) }], details: {} };
    },
  }) as BrokerTool;

  const call = defineTool({
    name: "call_mcp_tool",
    label: "调用 MCP 工具",
    // 意图字段只在搜索结果 schema 里出现过（那是拼给模型看的展示字段），
    // 代理调用时它必须填在本工具的 intent 上——不说清会出现"两头各填一份"的浪费
    description: "调用 search_mcp_tools 返回的 MCP 工具。name 必须是完整工具名，arguments 按搜索得到的参数结构填写；intent 用一句中文说明本次调用目的（意图只填这一处，搜索结果 schema 里的 _intent 不必再放进 arguments）。调用仍受原工具的权限与审批限制。",
    promptSnippet: "按搜索结果调用一个 MCP 工具（保留原工具的权限与参数校验）",
    parameters: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const, description: "search_mcp_tools 返回的完整工具名" },
        arguments: { type: "object" as const, description: "该工具的参数对象", additionalProperties: true },
        intent: { type: "string" as const, description: "一句中文说明本次调用目的（≤12 字）" },
      },
      required: ["name", "arguments", "intent"],
    },
    async execute(toolCallId: string, params: { name: string; arguments: Record<string, unknown>; intent: string }, signal: AbortSignal,
      onUpdate: Parameters<ToolDefinition["execute"]>[3], ctx: Parameters<ToolDefinition["execute"]>[4]) {
      if (getMode() === "readonly") throw new Error("只读模式不可使用 MCP");
      const server = availableServers(projectPath)
        .map((s) => s.name)
        .filter((name) => params.name.startsWith(`mcp__${name}__`))
        .sort((a, b) => b.length - a.length)[0];
      if (!server) throw new Error("工具所属的 MCP 服务器不可用或尚未确认启用");
      const tools = await loadMcpServerTools(server, projectPath, getMode, contextId);
      const tool = tools.find((entry) => entry.name === params.name);
      if (!tool) throw new Error(`MCP 工具「${params.name}」已不存在，请重新搜索`);
      // SDK 正常工具调用会先校验 schema；代理调用必须显式复用同一个校验器。
      // pi-ai 是 ESM-only，Electron 主进程 CJS 产物必须保留动态 import，不能在文件顶部静态导入。
      const { validateToolArguments } = await import("@earendil-works/pi-ai");
      const validated = validateToolArguments(tool, {
        type: "toolCall", id: toolCallId, name: tool.name,
        arguments: { ...params.arguments, _intent: params.intent },
      });
      // 权限判断必须看到 mcp__server__tool 原名及真实参数，不能只检查 call_mcp_tool。
      const guarded = wrapToolWithPermission(tool, { canUseTool });
      return guarded.execute(toolCallId, validated, signal, onUpdate, ctx);
    },
  }) as BrokerTool;

  return [search, call];
}
