/**
 * 粘贴导入工具（import_mcp_server / import_skill）
 *
 * 用户把 MCP 配置 JSON、启动命令或 skill 仓库链接粘贴给 Mint 说「装这个」——
 * 这是绝大多数用户安装扩展的真实路径（对齐 CC 的 add-json / marketplace add）。
 *
 * 开关策略：恒装（不进 D8）——导入是用户明确意图驱动的写入（粘贴即指令），
 * 与 manage_skill 的「AI 自主创建」性质不同；风险兜底：MCP 工具执行仍走 canUseTool 审批，
 * 导入本身只写配置/拷文件，不执行任何下载内容。
 */

import type { ToolDefinition } from "./pi-sdk";
import { getDefineToolFn } from "./pi-sdk";
import { parseMcpConfig, saveMcpServer } from "./mcp-service";
import { reloadMcpTools } from "./permission/mcp-adapter";
import { importSkillFromDir, importSkillFromUrl } from "./skill-service";

export async function createImportTools(): Promise<ToolDefinition[]> {
  const defineTool = await getDefineToolFn();
  const tools: ToolDefinition[] = [];

  tools.push(defineTool({
    name: "import_mcp_server",
    label: "导入 MCP 服务器",
    description:
      "从用户粘贴的配置文本安装 MCP 服务器。支持：完整 {\"mcpServers\":{...}} JSON、单个 server JSON、" +
      "claude mcp add/add-json 命令行、裸启动命令（npx/uvx/node 等）。解析并校验后写入用户级配置，" +
      "下次发消息即生效（免重启）。**仅在用户提供 MCP 配置或命令时调用**；写入后告知用户已装好、可在设置→插件→MCP 查看",
    promptSnippet: "从粘贴的配置/命令安装 MCP 服务器",
    parameters: {
      type: "object" as const,
      properties: {
        text: { type: "string" as const, description: "用户粘贴的配置 JSON 或启动命令原文" },
      },
      required: ["text" as const],
    },
    async execute(_tid: unknown, params: { text: string }) {
      const parsed = parseMcpConfig(params.text);
      if (!parsed.ok) {
        return { content: [{ type: "text" as const, text: `导入失败：${parsed.error}` }], details: {} };
      }
      const results: string[] = [];
      let anyOverwrite = false;
      for (const [name, cfg] of Object.entries(parsed.parsed.servers) as Array<[string, import("./mcp-service").McpServerConfig]>) {
        const r = saveMcpServer(name, cfg);
        results.push(r.ok
          ? `✅ ${name}（${cfg.type}）已添加`
          : `❌ ${name}：${r.error}`);
        if (r.ok && r.overwritten) anyOverwrite = true;
      }
      if (results.some((r) => r.startsWith("✅"))) reloadMcpTools();
      const notes = parsed.parsed.notes.length ? "\n提示：" + parsed.parsed.notes.join("；") : "";
      const text = results.join("\n") + notes
        + (results.some((r) => r.startsWith("✅")) ? "\n已生效（下次发消息即可用，无需重启）。" + (anyOverwrite ? "注意：有同名服务器被覆盖。" : "") : "");
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  }) as any as ToolDefinition);

  tools.push(defineTool({
    name: "import_skill",
    label: "导入 Skill",
    description:
      "从用户提供的来源安装 skill 到手写 skill 区（~/.easymint/skills/）。支持：GitHub/GitLab/Gitee 仓库链接、" +
      "本地目录路径。导入前校验「目录/SKILL.md」结构；只拷贝文件，不执行仓库内任何脚本。" +
      "**仅在用户提供 skill 链接或目录时调用**；成功后告知用户：当前会话即可用 use_skill 加载，重启后进入技能列表",
    promptSnippet: "从链接/目录安装 skill",
    parameters: {
      type: "object" as const,
      properties: {
        source: { type: "string" as const, description: "GitHub/GitLab/Gitee 仓库链接，或本地目录路径（支持 ~）" },
        name: { type: "string" as const, description: "可选：指定 skill 名称（缺省取目录名/仓库名）" },
        overwrite: { type: "boolean" as const, description: "同名时是否覆盖（默认 false）" },
      },
      required: ["source" as const],
    },
    async execute(_tid: unknown, params: { source: string; name?: string; overwrite?: boolean }) {
      const isUrl = /^https:\/\//i.test(params.source.trim());
      const r = isUrl
        ? importSkillFromUrl(params.source, { name: params.name, overwrite: params.overwrite })
        : importSkillFromDir(params.source, { name: params.name, overwrite: params.overwrite });
      const text = r.ok
        ? `✅ skill「${r.name}」已安装到 ${r.path}。当前会话即可用 use_skill 加载；重启后进入技能列表。`
        : `导入失败：${r.error}`;
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  }) as any as ToolDefinition);

  return tools;
}
