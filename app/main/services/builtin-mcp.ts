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
  tools.push(defineTool(noArgTool("show_confirm_dev", "确认开发", "通知前端显示「确认开发」按钮。", () => broadcast("agent:confirm-dev", {}))) as any);
  tools.push(defineTool(noArgTool("show_new_project", "新建项目", "通知前端显示「新建项目」按钮。", () => broadcast("agent:new-project", {}))) as any);
  tools.push(defineTool(noArgTool("refresh_tasks", "刷新任务列表", "通知前端重新加载 task.json。", () => {
    if (!projectPath) return "当前无项目路径";
    broadcast("agent:task-status", { taskId: "", status: "pending", projectPath });
    return "已通知前端刷新任务列表";
  })) as any);
  tools.push(defineTool(noArgTool("show_prototype", "显示原型", "通知前端打开 EM HTML 编辑器。", () => {
    if (!projectPath) return "当前无项目路径";
    broadcast("editor:open-prototype", { projectPath });
    return "原型已生成，编辑器窗口即将打开。";
  })) as any);

  // set_task_status
  tools.push(defineTool({
    name: "set_task_status", label: "更新任务状态",
    description: "更新 task.json 中某任务的运行时状态并实时刷新 UI。① 调 Builder 前 → building; ② 调 Evaluator 前 → evaluating; ③ 验收通过 → done; ④ 验收失败 → failed。",
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
        return `${idx + 1}. [${st}] ${i.title as string}`;
      });
      const open = raw.filter((i) => !(i.status === "fixed" || i.resolved)).length;
      return `共 ${raw.length} 条，${open} 条未修复：\n\n${lines.join("\n")}`;
    } catch (e) { return `读取失败: ${(e as Error).message}`; }
  })) as any);

  // rename_project
  tools.push(defineTool({
    name: "rename_project", label: "重命名项目",
    description: "重命名当前项目。调用后告知用户即将重启。仅打包版本可用。",
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
      description: "描述图片内容。支持本地路径或 URL。",
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
      description: "抓取网页内容。支持各类网页，返回提取后的文本。",
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

/** 兼容旧接口 */
export function buildBuiltinMcpServers(_p?: string): Record<string, unknown> { return {}; }
