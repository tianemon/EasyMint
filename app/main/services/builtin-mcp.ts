/**
 * EM 产品工具 — set_task_status / show_confirm_dev 等
 *
 * 工具执行逻辑在此定义，API 客户端在 api-clients.ts。
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { broadcast } from "./ipc-broadcast";
import { describeImage, webFetch, isToolEnabled } from "./api-clients";
import { validateTaskStatus } from "./hooks";
import type { ToolDefinition } from "./pi-sdk";
import { getDefineToolFn } from "./pi-sdk";

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
  tools.push(defineTool(noArgTool("show_new_project", "新建项目", "显示「新建项目」按钮。用户不在项目中且表达新建意图时调用。", () => broadcast("agent:new-project", {}))) as any);
  tools.push(defineTool(noArgTool("refresh_tasks", "刷新任务列表", "通知前端重新加载 task.json。", () => {
    if (!projectPath) return "当前无项目路径";
    broadcast("agent:task-status", { taskId: "", status: "pending", projectPath });
    return "已通知前端刷新任务列表";
  })) as any);
  tools.push(defineTool(noArgTool("show_prototype", "显示原型", "打开 EM HTML 编辑器预览原型。**「打开/预览」≠「验证渲染」**：用户要看原型时直接打开即可，不要用 Playwright 渲染/截图/起服务器——渲染正确性审查是从代码推理的步骤，与打开给用户看是两件事。", () => {
    if (!projectPath) return "当前无项目路径";
    broadcast("editor:open-prototype", { projectPath });
    return "原型已生成，编辑器窗口即将打开。";
  })) as any);

  // set_task_status
  tools.push(defineTool({
    name: "set_task_status", label: "更新任务状态",
    description: "标记 task.json 任务的开始状态并实时刷新 UI。只在两个时机调用：① 调 Builder 前 → building；② Builder 完成、调 Evaluator 前 → evaluating。done / failed 由委派执行结果自动回写，不要手动标记。",
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

  // rename_project
  tools.push(defineTool({
    name: "rename_project", label: "重命名项目",
    description: "重命名当前项目。调用后告知用户即将重启。仅打包版本可用。",
    promptSnippet: "重命名当前项目（将重启应用）",
    parameters: {
      type: "object" as const,
      properties: { newName: { type: "string" as const } },
      required: ["newName"],
    },
    async execute(_tid: any, params: any) {
      if (!projectPath) return { content: [{ type: "text" as const, text: "当前无项目" }] };
      if (!app.isPackaged) return { content: [{ type: "text" as const, text: "重命名功能仅在打包版本中可用" }] };
      const { ProjectService } = await import("./project-service");
      const { Store } = await import("./store");
      const r = await new ProjectService(new Store()).rename(projectPath, params.newName);
      if (!r.ok) return { content: [{ type: "text" as const, text: r.error || "重命名失败" }] };
      app.relaunch(); app.quit();
      return { content: [{ type: "text" as const, text: `项目已复制为「${params.newName}」，即将重启。` }] };
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
        + "失败会返回明确的错误信息，不会产生乱码——不确定能否抓取时直接尝试。",
      promptSnippet: "抓取网页内容并提取文本",
      parameters: {
        type: "object" as const,
        properties: {
          url: { type: "string" as const },
          prompt: { type: "string" as const },
        },
        required: ["url"],
      },
      async execute(_tid: any, params: any) {
        try { const t = await webFetch(params); return { content: [{ type: "text" as const, text: t }] }; }
        catch (e) { return { content: [{ type: "text" as const, text: `web_fetch 失败: ${(e as Error).message}` }] }; }
      },
    } as any) as any);
  }

  return tools.filter(Boolean) as ToolDefinition[];
}
