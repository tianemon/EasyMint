/**
 * EM 产品工具 — set_task_status / show_confirm_dev 等
 *
 * 工具执行逻辑在此定义，API 客户端在 api-clients.ts。
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { broadcast } from "./ipc-broadcast";
import { describeImage, webFetch, webSearch, isToolEnabled } from "./api-clients";
import { validateTaskStatus } from "./hooks";
import type { ToolDefinition } from "./pi-sdk";
import { getDefineToolFn } from "./pi-sdk";
// 主进程 tsconfig 无 @shared 路径别名（只有 renderer 配了），这里走相对路径
import { INTENT_REQUIREMENT, stripIntentParams, withIntentParam } from "../../shared/tool-intent";

type TaskRec = { id: number | string; status?: string; title?: string };

// ── 无参工具工厂 ────────────────────────────────────

function noArgTool(name: string, label: string, desc: string, fn: () => void | string | { content: Array<{ type: "text"; text: string }> }): any {
  return {
    name, label, description: desc,
    // 默认 snippet = 描述首句（去掉句号），让工具出现在提示词 Available tools 清单
    promptSnippet: desc.split("。")[0],
    parameters: { type: "object" as const, properties: {} },
    async execute() {
      const r = fn();
      if (typeof r === "string") return { content: [{ type: "text" as const, text: r }], details: {} };
      if (r && typeof r === "object" && "content" in r) return { ...r, details: (r as any).details ?? {} };
      return { content: [{ type: "text" as const, text: "ok" }], details: {} };
    },
  };
}

// ── 产品工具列表 ────────────────────────────────────

export async function createProductTools(projectPath?: string): Promise<ToolDefinition[]> {
  const defineTool = await getDefineToolFn();
  const tools: ToolDefinition[] = [];

  // UI 控制工具（始终注册）
  tools.push(defineTool(noArgTool("show_confirm_dev", "确认开发", "显示「确认开发」按钮。中等及以上项目就绪时调用。就绪标准：① task.json ≥1 个任务；② README.md 和 AGENTS.md 已写；③ 依赖已安装、环境可构建（按技术栈验证）；④ 需先完成原型并获用户确认的项目已确认（G4）。极简项目不建 task.json，直接开发不走此流程。", () => broadcast("agent:confirm-dev", {}))) as any);
  tools.push(defineTool(noArgTool("refresh_tasks", "刷新任务列表", "通知前端重新加载 task.json。", () => {
    if (!projectPath) return "当前无项目路径";
    broadcast("agent:task-status", { taskId: "", status: "pending", projectPath });
    return "已通知前端刷新任务列表";
  })) as any);
  tools.push(defineTool(noArgTool("show_prototype", "显示原型", "打开 EM HTML 编辑器预览原型。**「打开/预览」≠「验证渲染」**：用户要看原型时直接打开即可；渲染正确性审查是交付前的另一步（见 creation-flow-prototype），不要夹带在这里做。", () => {
    if (!projectPath) return "当前无项目路径";
    broadcast("editor:open-prototype", { projectPath });
    return "原型已生成，编辑器窗口即将打开。";
  })) as any);

  // set_task_status
  tools.push(defineTool({
    name: "set_task_status", label: "更新任务状态",
    description: "标记 task.json 任务状态并实时刷新 UI。调用时机：① 委派前 → building；② 交 Evaluator 前 → evaluating；③ **你亲自实现并自验通过 → done**（亲自做的没有委派结果可回写，不标记进度条会停在 building）。委派实现的 done / failed 由系统自动回写，不要手动标记。",
    promptSnippet: "更新 task.json 任务状态并刷新 UI（building/evaluating）",
    parameters: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" as const },
        status: { type: "string" as const, enum: ["pending", "building", "evaluating", "done", "failed"] },
      },
      required: ["taskId", "status"],
    },
    async execute(_tid: any, params: any) {
      if (!projectPath) return { content: [{ type: "text" as const, text: "当前无项目路径" }] };
      const err = validateTaskStatus(projectPath, params.taskId, params.status);
      if (err) return { content: [{ type: "text" as const, text: err }] };
      const fp = join(projectPath, "task.json");
      if (!existsSync(fp)) return { content: [{ type: "text" as const, text: "task.json 不存在" }] };
      try {
        const data = JSON.parse(readFileSync(fp, "utf-8"));
        const task = (data.tasks || []).find((t: TaskRec) => String(t.id) === String(params.taskId));
        if (!task) return { content: [{ type: "text" as const, text: `未找到 id=${params.taskId} 的任务` }] };
        task.status = params.status;
        const tmp = fp + ".tmp";
        writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
        renameSync(tmp, fp);
        broadcast("agent:task-status", { taskId: String(params.taskId), status: params.status, projectPath });
        return { content: [{ type: "text" as const, text: `任务 ${params.taskId} 状态已更新为 ${params.status}` }] };
      } catch (e) { return { content: [{ type: "text" as const, text: `更新失败: ${(e as Error).message}` }] }; }
    },
  } as any) as any);

  // list_issues
  tools.push(defineTool(noArgTool("list_issues", "列出 Issue", "读取项目 Issue 面板记录的问题清单。", () => {
    if (!projectPath) return "当前无项目路径";
    const p = join(projectPath, ".easymint", "issues.json");
    if (!existsSync(p)) return "暂无记录的 Issue";
    try {
      const data = JSON.parse(readFileSync(p, "utf-8"));
      const raw = (data.issues as Array<Record<string, unknown>>) || [];
      if (raw.length === 0) return "暂无记录的 Issue";
      const lines = raw.map((i, idx) => {
        const st = i.status === "fixed" ? "已修复" : (i.resolved ? "已修复" : "未修复");
        const mod = i.module ? `（${i.module as string}）` : "";
        return `${idx + 1}. [${st}] ${i.title as string}${mod}`;
      });
      const open = raw.filter((i) => !(i.status === "fixed" || i.resolved)).length;
      return `共 ${raw.length} 条，${open} 条未修复：\n\n${lines.join("\n")}`;
    } catch (e) { return `读取失败: ${(e as Error).message}`; }
  })) as any);

  // set_issue_status
  tools.push(defineTool({
    name: "set_issue_status", label: "更新问题状态",
    description: "标记 Issue 面板问题的状态（未修复/已修复）。用户确认问题已解决后调用 → fixed；需要重新打开时 → open。序号与 list_issues 输出一致。",
    promptSnippet: "更新问题记录的状态（open/fixed）",
    parameters: {
      type: "object" as const,
      properties: {
        index: { type: "number" as const, description: "list_issues 输出中的序号（从 1 开始）" },
        status: { type: "string" as const, enum: ["open", "fixed"] },
      },
      required: ["index", "status"],
    },
    async execute(_tid: any, params: any) {
      if (!projectPath) return { content: [{ type: "text" as const, text: "当前无项目路径" }] };
      const p = join(projectPath, ".easymint", "issues.json");
      if (!existsSync(p)) return { content: [{ type: "text" as const, text: "暂无记录的 Issue" }] };
      try {
        const data = JSON.parse(readFileSync(p, "utf-8"));
        const issues = (data.issues as Array<Record<string, unknown>>) || [];
        const issue = issues[Number(params.index) - 1];
        if (!issue) return { content: [{ type: "text" as const, text: `序号 ${params.index} 不存在（共 ${issues.length} 条）` }] };
        issue.status = params.status === "fixed" ? "fixed" : "open";
        writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
        return { content: [{ type: "text" as const, text: `已更新：[${params.status === "fixed" ? "已修复" : "未修复"}] ${issue.title}` }] };
      } catch (e) { return { content: [{ type: "text" as const, text: `更新失败: ${(e as Error).message}` }] }; }
    },
  } as any) as any);

  // describe_image（按开关）
  if (isToolEnabled("vision")) {
    tools.push(defineTool({
      name: "describe_image", label: "描述图片",
      description: "描述图片内容（支持本地路径或 URL）。作为读图的**静默回退**：优先用当前模型自身识图，仅当读图报错或图片被省略（模型不支持视觉，报错信息因模型而异）时才调用本工具。回退属正常流程，保持静默——不向用户解释「模型不支持图片」、不声明改用了工具，直接调用并按结果继续任务。仅当本工具也失败时才如实告知用户无法读图。",
      promptSnippet: "用视觉模型描述图片内容（本地路径或 URL）",
      parameters: {
        type: "object" as const,
        properties: {
          path: { type: "string" as const },
          prompt: { type: "string" as const },
        },
        required: ["path"],
      },
      async execute(_tid: any, params: any) {
        try { const t = await describeImage(params); return { content: [{ type: "text" as const, text: t }] }; }
        catch (e) { return { content: [{ type: "text" as const, text: `describe_image 失败: ${(e as Error).message}` }] }; }
      },
    } as any) as any);
  }

  // web_fetch（按开关）
  if (isToolEnabled("webFetch")) {
    tools.push(defineTool({
      name: "web_fetch", label: "抓取网页",
      // 描述即能力契约：不写「支持各类网页」这类过宽承诺——动态渲染/需登录/纯二进制
      // 的 URL 可能抓取失败；写明失败兜底（返回明确错误、不产生乱码），消除模型
      // 「试了会浪费/会污染」的顾虑（对齐 read 增强的同一原则）
      description: "抓取网页内容并提取正文文本（在线文档、博客、API 页面等静态可访问网页）。"
        + "动态渲染、需登录、或返回非文本内容（如 PDF 文件、图片）的 URL 可能抓取失败，"
        + "失败会返回明确的错误信息，不会产生乱码——不确定能否抓取时直接尝试。"
        // 与 Tavily MCP 的等价关系必须写明：实测模型会同时调 web_fetch 和 Tavily 的抓取工具
        // 查同一个 URL（两者底层都是 Tavily extract），既重复消耗额度又得到两份相同结果。
        // 措辞已随「MCP 按需加载」更新：那两个工具名不再出现在工具列表里（首轮只注册
        // search_mcp_tools / call_mcp_tool），照旧写「工具列表里的 X」会引导模型去找一个
        // 它看不到的名字——反而多一次往返。
        + "**与 Tavily MCP 是同一个东西**：MCP 服务器 tavily 的抓取工具（需先用 search_mcp_tools 查找）"
        + "走的是同一套 Tavily 抓取；同一个 URL 只抓一次——用了本工具就不要再调 Tavily MCP（反之亦然）。"
        + `\n${INTENT_REQUIREMENT}`,
      promptSnippet: "抓取网页内容并提取文本",
      // _intent 只给模型看（聊天页展示这次抓取在查什么），转发前剥掉（见 execute）
      parameters: withIntentParam({
        type: "object" as const,
        properties: {
          url: { type: "string" as const },
          prompt: { type: "string" as const },
        },
        required: ["url"],
      }),
      async execute(_tid: any, params: any) {
        const args = stripIntentParams(params) as { url: string; prompt?: string };
        try { const t = await webFetch(args); return { content: [{ type: "text" as const, text: t }] }; }
        catch (e) { return { content: [{ type: "text" as const, text: `web_fetch 失败: ${(e as Error).message}` }] }; }
      },
    } as any) as any);
  }

  // web_search（按开关，与 web_fetch 共用 TAVILY_API_KEY）
  if (isToolEnabled("webSearch")) {
    tools.push(defineTool({
      name: "web_search", label: "联网搜索",
      description: "联网搜索并返回结果摘要（标题 + URL + 摘要片段）。适用：需要查实时/最新/在线信息、查某个话题有哪些来源时调用。"
        + "拿到 URL 后配合 web_fetch 抓取整页读全文。动态渲染、需登录的查询可能无结果；没有匹配结果会明确告知。"
        // 同上：模型曾为同一个问题既调 web_search 又调 Tavily 的搜索工具。
        // 措辞同样随按需加载更新（工具列表里已无 mcp__tavily__search 这个名字）。
        + "**与 Tavily MCP 是同一个东西**：MCP 服务器 tavily 的搜索工具（需先用 search_mcp_tools 查找）"
        + "底层就是 Tavily 搜索；同一个问题只搜一次——用了本工具就不要再调 Tavily MCP（反之亦然）。"
        + `\n${INTENT_REQUIREMENT}`,
      promptSnippet: "联网搜索并返回结果摘要",
      parameters: withIntentParam({
        type: "object" as const,
        properties: {
          query: { type: "string" as const },
          max_results: { type: "number" as const, description: "返回结果条数（1-20，默认 5）" },
        },
        required: ["query"],
      }),
      async execute(_tid: any, params: any) {
        const args = stripIntentParams(params) as { query: string; max_results?: number };
        try { const t = await webSearch(args); return { content: [{ type: "text" as const, text: t }] }; }
        catch (e) { return { content: [{ type: "text" as const, text: `web_search 失败: ${(e as Error).message}` }] }; }
      },
    } as any) as any);
  }

  return tools.filter(Boolean) as ToolDefinition[];
}
