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
import { networkService } from "./network-service";

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
      description: "描述图片内容（支持本地路径或 URL）。**当模型无法直接读取图片时必用**：收到「模型不支持图片/图片被省略」之类的报错（报错信息因模型而异），不要继续尝试读图，改用本工具获取文字描述。识别失败时明确告知用户，不静默跳过。",
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
      description: "抓取网页内容。支持各类网页，返回提取后的文本。",
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

  // ── 设备互联 + 项目迁移工具（Mint 掌控迁移流程） ──
  // 设备互联工具(纯手动迁移——Mint 仅保留设备管理能力)
  // 接收端恢复由系统执行,不需要 Mint 工具（方案见 docs/design/跨设备会话迁移与设备互联方案.md 第四章）
  const net = networkService;

  tools.push(defineTool({
    name: "list_devices", label: "列出设备",
    description: "列出已配对设备（含在线/离线状态）与可发现的可用设备。迁移项目前先调用,让用户确认目标设备。",
    promptSnippet: "列出已配对与可发现的设备",
    parameters: { type: "object" as const, properties: {} },
    async execute() {
      const paired = net.listPaired();
      const discovered = net.listDiscovered();
      const lines: string[] = [];
      lines.push("已配对设备:");
      if (paired.length === 0) lines.push("  (无)");
      for (const p of paired) lines.push(`  ${p.name} [${p.online ? "在线" : "离线"}] id=${p.id}`);
      lines.push("可用设备(需配对):");
      if (discovered.length === 0) lines.push("  (无——让对方开启「可被发现」后重新扫描)");
      for (const d of discovered) lines.push(`  ${d.name} id=${d.id} ip=${d.address}:${d.port}`);
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  } as any) as any);

  // 设备管理工具(与手动入口同一服务)
  tools.push(defineTool({
    name: "toggle_discoverable", label: "可被发现开关",
    description: "开启/关闭本机的可被发现状态(开启后其他设备能发现并配对,5 分钟自动关闭;已配对连接不受影响)。",
    promptSnippet: "开关可被发现状态",
    parameters: {
      type: "object" as const,
      properties: { on: { type: "boolean" as const, description: "true 开启 / false 关闭" } },
      required: ["on"],
    },
    async execute(_tid: any, params: any) {
      if (params.on) net.startPairMode();
      else net.stopPairMode();
      return { content: [{ type: "text" as const, text: params.on ? "已开启可被发现(5 分钟后自动关闭)" : "已关闭可被发现" }] };
    },
  } as any) as any);

  tools.push(defineTool({
    name: "unpair_device", label: "解除配对",
    description: "解除与指定设备的配对(断开连接并删除持久化配对记录)。",
    promptSnippet: "解除与设备的配对",
    parameters: {
      type: "object" as const,
      properties: { deviceId: { type: "string" as const, description: "设备 ID(list_devices 返回)" } },
      required: ["deviceId"],
    },
    async execute(_tid: any, params: any) {
      const d = net.listPaired().find((x) => x.id === params.deviceId);
      if (!d) return { content: [{ type: "text" as const, text: `设备 ${params.deviceId} 不在已配对列表` }] };
      net.unpair(params.deviceId);
      return { content: [{ type: "text" as const, text: `已解除与 ${d.name} 的配对` }] };
    },
  } as any) as any);

  tools.push(defineTool({
    name: "rename_device", label: "设备改名",
    description: "修改本机设备名称(其他设备列表展示用,持久化)。",
    promptSnippet: "修改本机设备名称",
    parameters: {
      type: "object" as const,
      properties: { name: { type: "string" as const, description: "新设备名" } },
      required: ["name"],
    },
    async execute(_tid: any, params: any) {
      net.setDeviceName(params.name as string);
      return { content: [{ type: "text" as const, text: `设备名已改为「${net.getSelf().name}」` }] };
    },
  } as any) as any);

  tools.push(defineTool({
    name: "request_pair", label: "请求配对",
    description: "向指定设备发起配对请求(需要对方开启「可被发现」)。对方设备将弹出确认窗口,用户确认后配对完成并持久化。",
    promptSnippet: "与指定设备配对(弹窗确认)",
    parameters: {
      type: "object" as const,
      properties: { deviceId: { type: "string" as const, description: "设备 ID(list_devices 返回)" } },
      required: ["deviceId"],
    },
    async execute(_tid: any, params: any) {
      const d = net.listDiscovered().find((x) => x.id === params.deviceId);
      if (!d) return { content: [{ type: "text" as const, text: `设备 ${params.deviceId} 未在可用列表——请让对方开启「可被发现」后调用 list_devices 重新确认` }] };
      const r = await net.requestPair(d);
      return { content: [{ type: "text" as const, text: r.ok ? `已向 ${d.name} 发起配对请求,等待对方确认…` : `配对失败: ${r.error ?? "未知错误"}` }] };
    },
  } as any) as any);

  return tools.filter(Boolean) as ToolDefinition[];
}
