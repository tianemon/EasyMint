/** MCP 工具目录：把完整 schema 留到模型明确搜索时，首轮只暴露两个稳定入口。 */
import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import { scanMcpServers, getMcpServerConfig, type McpServerManifest } from "../mcp-service";
import { readMcpInstructions } from "../mcp-instructions";
import { INTENT_REQUIREMENT } from "../../../shared/tool-intent";
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

/** 该 server 的协议自述（连接过一次后才存得下来）；取不到返回 undefined。 */
function serverInstructions(s: McpServerManifest, projectPath: string): string | undefined {
  const cfg = getMcpServerConfig(s.name, { scope: s.scope, projectPath });
  return readMcpInstructions(s.name, cfg, projectPath);
}

/** 从自述里挑一句能当「用途说明」的：优先正文行（跳过 markdown 标题），去掉行内标记，限长。
 *  自述格式五花八门，这里只求"比一个光秃秃的 server 名强"，不追求精确摘要。 */
function firstUsableLine(text: string, maxLen: number): string {
  const lines = text
    .split("\n")
    .map((raw) => ({
      heading: /^\s*#{1,6}\s/.test(raw),
      text: raw.replace(/^[#>*\-\s]+/, "").replace(/[*`_#>]/g, "").replace(/\s+/g, " ").trim(),
    }))
    .filter((line) => line.text.length >= 12);
  const pick = lines.find((line) => !line.heading) ?? lines[0];
  if (!pick) return "";
  if (pick.text.length <= maxLen) return pick.text;
  const cut = pick.text.slice(0, maxLen - 1);
  const lastSpace = cut.lastIndexOf(" ");
  // 在词边界收尾——否则英文会被切成 "GitHu…" 这种半截词。中文行没有空格，退化成整段截断。
  return `${(lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** 给模型看的服务器清单：让它在"该不该找外部能力"这一步就能判断。
 *  用途说明优先取用户手填的 `description`；没填就退回 **server 自述首句**（缓存里取，见
 *  mcp-instructions——新接一个 server 因此不必手工配）。两者都没有就只露名字：
 *  不补占位词，免得模型把占位当成真实能力。 */
function describeServers(servers: McpServerManifest[], projectPath: string): string {
  return servers
    .map((s) => {
      const name = sanitizeForPrompt(s.name, 64);
      const desc = s.description
        ? sanitizeForPrompt(s.description, 40)
        : sanitizeForPrompt(firstUsableLine(serverInstructions(s, projectPath) ?? "", 60), 60);
      return desc ? `${name}（${desc}）` : name;
    })
    .join("、");
}

/** server 自述是**第三方文本**，会进模型上下文：去控制字符、收掉连续空行、限长。
 *  与进工具说明的 sanitizeForPrompt 不同，这里**保留换行**——自述是 markdown 结构，压成一行
 *  反而读不了；换行也逃不出 JSON.stringify 的转义，不会破坏结构。 */
function sanitizeInstructions(text: string, maxLen = 2000): string {
  const cleaned = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen)}…（自述过长已截断）` : cleaned;
}

/** 剥掉 mcp-adapter 追加的「每次调用都要填 _intent」。
 *  那句是写给**直接调用原始 MCP 工具**看的；经代理调用时意图填在 call_mcp_tool.intent 上，
 *  两处并存会让模型两头各填一份（功能无害——`params.intent` 会覆盖——但白费一次往返的 token）。
 *  只删这段固定文案：参数 schema 里的 `_intent` **不动**，因为 server 可能本来就有同名字段
 *  （`withIntentParam` 遇到同名会原样返回），从 schema 无法区分是我们加的还是它的。 */
function stripIntentRequirement(description: string): string {
  return description.replace(INTENT_REQUIREMENT, "").trim();
}

/** 中文关键词 → 英文别名。
 *  工具名与描述几乎都是英文，而检索是纯子串匹配、**跨不了语言**：实测在本机配置的 playwright
 *  （25 个工具）上，「截图」「打开网页」「点击按钮」等 8 种中文说法全部 0 分，与空查询同分，
 *  于是稳定排序退化成按 listTools 顺序取前 5 个——正好是最不相关的一批，且不报任何错。
 *  命中中文词时补上对应英文词参与打分；原词保留，别名只做加法、不改既有行为。
 *
 *  **收词原则**（决定这张表会不会变成随 server 增长的手工活）：
 *  ① 只收**跨领域通用词**——通用动词（创建/删除/搜索/发送…）与通用名词（文件/图片/文档…）,
 *     它们不随 server 数量增长，一次写够即可封顶；
 *  ② 不收**单一产品特有**的词（金价、持仓、某业务字段…）——那交给 server 自述（见 getInstructions）
 *     与"无命中回工具名清单"兜底，否则每接一个 server 都要来改这张表；
 *  ③ 不收**在该 server 每个工具名里都出现**的词（如 browser、page）——它们只会把所有工具分数
 *     拉平，让排序退化成 listTools 顺序，反而制造"看起来有结果"的错答案（实测：加 `page` 后
 *     「刷新页面」「看网页源码」首位变成 browser_close；去掉后这两条诚实回退成工具名清单，
 *     而「截图」「获取页面内容」等正确答案一条都没变差）。 */
const QUERY_ALIASES: ReadonlyArray<readonly [string, readonly string[]]> = [
  // 打开与浏览
  ["打开", ["navigate", "open"]],
  ["访问", ["navigate"]],
  ["导航", ["navigate"]],
  ["刷新", ["reload"]],
  ["关闭", ["close"]],
  ["前进", ["forward"]],
  ["后退", ["back"]],
  ["标签页", ["tab"]],
  // 页面内容与交互
  ["截图", ["screenshot"]],
  ["快照", ["snapshot"]],
  ["内容", ["content", "snapshot"]],
  ["抓取", ["snapshot", "fetch"]],
  ["点击", ["click"]],
  ["悬停", ["hover"]],
  ["输入", ["type", "fill"]],
  ["填写", ["fill"]],
  ["表单", ["form"]],
  ["选择", ["select"]],
  ["拖拽", ["drag"]],
  ["拖动", ["drag"]],
  ["滚动", ["scroll"]],
  ["等待", ["wait"]],
  ["尺寸", ["resize"]],
  ["调整", ["resize"]],
  // 键盘与对话框
  ["键盘", ["key", "press"]],
  ["按键", ["key", "press"]],
  ["对话框", ["dialog"]],
  ["弹窗", ["dialog", "popup"]],
  // 请求与执行
  ["控制台", ["console"]],
  ["网络", ["network"]],
  ["请求", ["request"]],
  ["执行代码", ["evaluate"]],
  ["执行", ["execute", "run"]],
  ["运行", ["run", "execute"]],
  // 增删改查
  ["创建", ["create"]],
  ["新建", ["create"]],
  ["建立", ["create"]],
  ["删除", ["delete"]],
  ["移除", ["remove"]],
  ["更新", ["update"]],
  ["修改", ["update", "edit"]],
  ["编辑", ["edit"]],
  ["读取", ["read"]],
  ["获取", ["get", "fetch"]],
  ["搜索", ["search"]],
  ["查找", ["find", "search"]],
  ["查询", ["query", "search"]],
  ["列出", ["list"]],
  ["列表", ["list"]],
  ["移动", ["move"]],
  ["复制", ["copy"]],
  ["重命名", ["rename"]],
  // 文件与数据
  ["文件", ["file"]],
  ["文件夹", ["folder"]],
  ["目录", ["directory", "folder"]],
  ["图片", ["image", "picture"]],
  ["文档", ["document"]],
  ["表格", ["table", "sheet"]],
  ["上传", ["upload"]],
  ["下载", ["download"]],
  // 协作与版本
  ["提交", ["commit", "submit"]],
  ["分支", ["branch"]],
  ["仓库", ["repo", "repository"]],
  ["合并", ["merge"]],
  ["拉取", ["pull"]],
  ["评论", ["comment"]],
  ["标签", ["tag", "label"]],
  ["版本", ["version", "release"]],
  ["发布", ["release", "publish"]],
  // 通信与账户
  ["发送", ["send"]],
  ["消息", ["message"]],
  ["邮件", ["mail", "email"]],
  ["登录", ["login", "sign"]],
  ["用户", ["user"]],
  ["权限", ["permission", "access"]],
  ["日程", ["calendar", "event"]],
  ["任务", ["task"]],
  // 运维
  ["安装", ["install"]],
  ["部署", ["deploy"]],
  ["配置", ["config"]],
  ["设置", ["setting", "config"]],
];

/** 打分用的关键词 = 原词 + 中文别名展开（去重保序）。 */
function queryWords(query: string): string[] {
  const base = query.toLowerCase().split(/\s+/).filter(Boolean);
  const extra: string[] = [];
  for (const [zh, en] of QUERY_ALIASES) {
    if (query.includes(zh)) extra.push(...en);
  }
  return [...new Set([...base, ...extra])];
}

export async function createMcpBrokerTools(
  projectPath: string,
  contextId: string,
  getMode: () => PermissionMode,
  canUseTool: ToolWrapOptions["canUseTool"],
): Promise<ToolDefinition[]> {
  const defineTool = await getDefineToolFn();
  const servers = availableServers(projectPath);
  // 自述是"这个 server 怎么用"的说明，每会话每个 server 给一次就够：每次搜索都塞会白烧 token
  // （实测 codegraph 的自述近 6K 字符，截断后仍占 2K）。
  const instructionsShown = new Set<string>();
  const search = defineTool({
    name: "search_mcp_tools",
    label: "查找 MCP 工具",
    description: `按需查找 MCP 工具。可用服务器：${describeServers(servers, projectPath) || "无"}。任务需要上述外部能力时先查一次，再用 call_mcp_tool 调用；不要猜工具参数。query 优先用英文关键词——工具名与描述都是英文，中文只覆盖「截图/打开/点击」这类常见操作词。只读模式下不可用。`,
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
      const words = queryWords(params.query?.trim() ?? "");
      const ranked = tools.map((tool) => ({
        tool,
        score: words.reduce((score, word) => score + (tool.name.toLowerCase().includes(word) ? 3 : 0)
          + (tool.description.toLowerCase().includes(word) ? 1 : 0), 0),
      })).sort((a, b) => b.score - a.score);
      const limit = Number.isFinite(params.limit) ? Math.max(1, Math.min(8, Math.floor(params.limit!))) : 5;
      // 只返回真正命中的：0 分结果占位会让模型把"没搜到"读成"这个服务器没有该能力"——
      // 未命中时所有工具同分，稳定排序退化成 listTools 顺序的前 N 个（最不相关的一批）。
      const hits = ranked.filter(({ score }) => score > 0).slice(0, limit);
      const names = tools.map((tool) => tool.name).slice(0, 40);
      // 顺带把 server 的协议自述交给模型（连接已建立，零额外成本）：它回答"这个 server 怎么用"，
      // 是模型后续在同一 server 上挑工具的依据；每会话每个 server 只给一次。
      const manifest = current.find((s) => s.name === server);
      const instructions = !manifest || instructionsShown.has(server)
        ? ""
        : sanitizeInstructions(serverInstructions(manifest, projectPath) ?? "");
      if (instructions) instructionsShown.add(server);
      const base = { server, total: tools.length, ...(instructions ? { instructions } : {}) };
      // 首位分数 <3 表示**没有任何工具名被命中**，只是描述里的偶合——这种"弱匹配"看着像命中却
      // 未必贴切，所以连工具名清单一起给，让模型自己判断。
      const payload = hits.length > 0
        ? {
            ...base,
            tools: hits.map(({ tool }) => ({ name: tool.name, description: stripIntentRequirement(tool.description), parameters: tool.parameters })),
            ...((hits[0]?.score ?? 0) < 3
              ? { hint: "以下按描述模糊匹配，未必贴切；不合适可改用英文关键词，或从下列工具名中选：", names }
              : {}),
          }
        : { ...base, tools: [], hint: "没有匹配的工具。可改用英文关键词，或从下列工具名中选一个：", names };
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }], details: {} };
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
