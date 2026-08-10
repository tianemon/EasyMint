/**
 * Agent Service — Pi SDK 驱动
 *
 * 步骤三重写：Claude SDK 的 query/channel/for-await 全部替换为 Pi 的
 * createAgentSession + session.prompt + session.subscribe。
 *
 * 对外接口（IPC handlers 调用）完全不变。
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { BrowserWindow } from "electron";
import { resolveHome } from "../utils/paths";
import { broadcast } from "./ipc-broadcast";
import { Store } from "./store";
import { resolveEffectivePrompt } from "./system-prompt-manager";
import { buildSkillsPrompt } from "./skill-service";
import { getActiveModel, resetModelRuntime } from "./pi-init";
import { createPiSession, resumePiSession, listPiSessions } from "./pi-session";
import { createTaskTool } from "./task/tool";
import { createAgentTemplateTool } from "./task/tool";
import { registerSessionIdMapping, abortTask, getRunningSummary, resolveParentSessionId } from "./task/registry";
import { formatShellResult } from "./background-shell/tool";
import { backgroundShellRegistry, type BackgroundShell } from "./background-shell/registry";
import { systemMessage, type SystemMessageKind, type SystemMessagePayload } from "../../shared/prompts";
import { normalizeApiError } from "../../shared/api-errors";
import { createProductTools } from "./builtin-mcp";
import { loadMcpTools } from "./permission/mcp-adapter";
import { permissionService } from "./permission/agent-permission-service";
import type { CanUseToolOptions, PermissionResult } from "./permission/agent-permission-service";
import {
  bridgeSessionEvents,
  type PiChatEvent,
} from "./event-bridge";
import type { AgentSession, AgentSessionEvent, ToolDefinition } from "./pi-sdk";
import { getDefineToolFn } from "./pi-sdk";
import type { Model } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { renameSession, hasCustomTitle } from "./session-service";
import { MAX_COMPACT, finishRotation, type RotationState } from "./rotation";
import { buildProjectEnvSection, buildProjectProfileSection, readProjectProfile } from "./prompt-sections";
import { DESIGNER_AGENT_PROMPT } from "../../shared/prompts";
import { GroupSessionManager, type GroupSessionMeta, type GroupRecord } from "./group-session";

// ── 类型 ────────────────────────────────────────────

/** 权限回调签名（与 permissionService.createCanUseTool 返回一致） */
export type CanUseToolFn = (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;

/** 系统消息 kind → 首条会话标题(SDK 列表优先读 session_info.name,custom 首条时兜底) */
const SYSTEM_KIND_TITLES: Record<string, string> = {
  "project-created": "项目初始化",
  flow: "流程指令",
  handoff: "会话交接",
  summary: "上下文摘要",
  delegation: "子 Agent 委派",
  shell: "后台命令",
};

/** 群聊协作规则:注入每个群聊 Agent 的 system prompt(需求 4) */
/** 群聊协作规则(注入每个群聊 Agent 的 system prompt)。{members} 和 {role} 由 createGroup 时替换。 */
const GROUP_COLLABORATION_RULE = `[群聊协作规则]
你正在一个多 Agent 群聊会话中协作。群聊成员: {members}

你会持续收到共享上下文(其他成员的发言和结论)——这些是累积的历史记录,你不需要逐条回复。

核心规则:
1. 只有被 @ 或收到"群聊激活"系统消息时才回话。
   回话时,优先响应当前最新指令,不要纠结于历史对话。
2. 当某部分工作更适合其他成员处理时,调用 assign_to_agent({target:"<角色名>"}) 工具,
   指定目标角色即可,不要硬编角色名称。
   无需重复说明任务——对方上下文里已有全部信息。
3. 你的回复结论会自动同步给所有成员作为背景上下文。
   请保持结论清晰、独立可读,不引用其他成员未提供的代码或信息。

禁止事项:
- 不要在每条背景消息后都回话——只在被显式激活(@ 或系统激活消息)时才回话`;


interface ActiveRun {
  runId: string;
  session: AgentSession | null;
  abortController: AbortController;
}

export interface ActiveChat extends RotationState {
  chatId: string;
  /** 对外 sessionId（Pi 真实 ID；前端迁移/权限/统计都用它） */
  sessionId: string;
  /** 新建会话时的 EM 临时 ID（task 工具绑定此 ID，findActiveChat 双键匹配） */
  tempSessionId?: string;
  session: AgentSession | null;
  abortController: AbortController;
  projectPath: string;
  currentModel?: string;
  agentType?: "mint" | "builder" | "evaluator" | "designer";
  status: string;
  firstUserMessage: string;
  assistantUuid: string;
  eventBuffer: PiChatEvent[];
}

/** 记录各 session 的 agent 类型 */
const sessionAgentTypes = new Map<string, string>();
const SESSION_TYPES_PATH = path.join(os.homedir(), ".easymint", "session-types.json");

function loadSessionTypes(): Map<string, string> {
  try {
    if (fs.existsSync(SESSION_TYPES_PATH)) {
      const data = JSON.parse(fs.readFileSync(SESSION_TYPES_PATH, "utf-8"));
      const map = new Map<string, string>();
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === "string") map.set(k, v);
      }
      return map;
    }
  } catch (e) { console.warn("[agent] 读取 session-types.json 失败:", (e as Error).message); }
  return new Map();
}

function saveSessionTypes(map: Map<string, string>): void {
  try {
    const dir = path.dirname(SESSION_TYPES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SESSION_TYPES_PATH, JSON.stringify(Object.fromEntries(map), null, 2));
  } catch (e) { console.warn("[agent] 保存 session-types.json 失败:", (e as Error).message); }
}

// 初始化时加载已有记录
const loaded = loadSessionTypes();
for (const [k, v] of loaded) sessionAgentTypes.set(k, v);

export function getDesignSessionIds(): string[] {
  const ids: string[] = [];
  for (const [id, type] of sessionAgentTypes) {
    if (type === "designer") ids.push(id);
  }
  return ids;
}

// ── 上下文压缩 ──────────────────────────────────────

// ── AgentService ────────────────────────────────────

/** Mint 主动停止委派工具:停止当前会话运行中的子 Agent(委派)。
    与用户点打断按钮等价,但由 Mint 自主决策(如发现子 Agent 方向错了/卡住)。
    支持精确停止单个任务(delegation_id + index,配合 list_agents 查看),缺省停全部 */
async function createStopAgentTool(sessionId: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "stop_agent",
    label: "停止子 Agent",
    description:
      "停止当前会话正在运行中的子 Agent(委派任务)。子 Agent 会被中止,任务状态回写 aborted。"
      + "指定 delegation_id + index 只停止该任务(先用 list_agents 查看);不指定则停止全部。"
      + "使用场景:① 发现子 Agent 方向错了,要重新委派 ② 子 Agent 卡住/超时 ③ 用户要求停下。",
    promptSnippet: "停止运行中的子 Agent(可精确停单个,缺省停全部)",
    promptGuidelines: [
      "子 Agent 偏离任务方向、卡住或用户要求停时,用此工具停止而不是等待",
      "批量委派时先 list_agents 查看,再用 delegation_id+index 精确停止跑偏的任务,保留正常的",
      "停止后任务状态自动回写 aborted,可重新委派修正后的任务",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        delegation_id: { type: "string" as const, description: "可选:委派 ID(list_agents 返回),指定后只停该委派" },
        index: { type: "number" as const, description: "可选:任务序号(list_agents 返回),与 delegation_id 搭配精确停止单个任务" },
        reason: { type: "string" as const, description: "可选:停止原因(便于记录)" },
      },
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      const { abortDelegations, abortTask } = await import("./task/registry");
      const reason = params.reason ? String(params.reason) : "Mint 主动停止";
      // 精确停止:delegation_id(+index) 指定单个
      if (params.delegation_id) {
        const did = String(params.delegation_id);
        const { getRunningDelegations } = await import("./task/registry");
        const match = getRunningDelegations(sessionId).find((r) => r.delegationId === did || r.delegationId.startsWith(did));
        if (!match) return { content: [{ type: "text" as const, text: `委派 ${did} 未在运行中` }] };
        if (typeof params.index === "number") {
          abortTask(match.delegationId, params.index);
          return { content: [{ type: "text" as const, text: `已停止任务 ${match.delegationId} 的 #${params.index}${reason ? `(${reason})` : ""}` }] };
        }
        match.abort();
        return { content: [{ type: "text" as const, text: `已停止委派 ${match.delegationId}${reason ? `(${reason})` : ""}` }] };
      }
      const count = abortDelegations(sessionId);
      const text = count > 0
        ? `已停止 ${count} 个运行中的子 Agent${reason ? `(${reason})` : ""}`
        : "当前没有运行中的子 Agent";
      return { content: [{ type: "text" as const, text }] };
    },
  } as any) as ToolDefinition;
}

/** Mint 查看委派进度工具:返回当前会话运行中的委派任务状态清单,
    配合 stop_agent 精确停止用(先看再决定) */
async function createListAgentsTool(sessionId: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "list_agents",
    label: "查看子 Agent",
    description:
      "查看当前会话正在运行中的子 Agent(委派任务)清单:每个委派的任务状态、已耗时、任务简述。"
      + "用于判断:① 还有哪些任务在跑 ② 哪个任务跑偏了/卡住了(配合 stop_agent 精确停止)。",
    promptSnippet: "查看运行中的子 Agent 状态(任务、状态、耗时)",
    promptGuidelines: [
      "委派进行中想了解进度/决定是否停止时,先 list_agents 查看",
      "返回的 delegation_id 和任务序号,可用于 stop_agent 精确停止",
    ],
    parameters: {
      type: "object" as const,
      properties: {},
    },
    async execute() {
      const { getRunningDelegations } = await import("./task/registry");
      const running = getRunningDelegations(sessionId);
      if (running.length === 0) return { content: [{ type: "text" as const, text: "当前没有运行中的子 Agent" }] };
      const lines: string[] = [];
      for (const r of running) {
        const elapsed = Math.max(0, Math.round((Date.now() - r.startedAt) / 1000));
        lines.push(`委派 ${r.delegationId} (已运行 ${elapsed}s, 共 ${r.tasks.length} 任务):`);
        for (let i = 0; i < r.tasks.length; i++) {
          const t = r.tasks[i]!;
          const status = r.taskStatuses[i] || "pending";
          const title = t.title || t.description || t.task.slice(0, 40);
          // 运行中实时状态:当前工具 + 已调工具数(jsonl 运行中不落盘,这是唯一实时信息)
          const currentTool = r.taskCurrentTools[i];
          const toolCount = r.taskToolCounts[i] ?? 0;
          const extra = status === "running"
            ? (currentTool ? ` — 当前工具: ${currentTool}` : "") + (toolCount > 0 ? ` (已调 ${toolCount} 个工具)` : "")
            : "";
          lines.push(`  任务 ${i}: [${status}] ${title}${extra}`);
        }
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    },
  } as any) as ToolDefinition;
}

/** Mint 查看子 Agent 执行过程工具(阶梯式):
    level=1 最新输出总结(默认,够判断就停);level=2 工具执行清单;level=3 全量思考+工具+输出(排查用) */
async function createReadAgentLogTool(sessionId: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "read_agent_log",
    label: "查看子 Agent 执行过程",
    description:
      "查看子 Agent 的执行过程(已落盘的思考/工具调用/输出)。"
      + "参数: delegation_id(list_agents 返回)+ index(任务序号)。"
      + "level=1(默认)只返回最新一条输出总结;level=2 返回工具执行清单;level=3 返回全量过程(慎用,消耗大)。"
      + "阶梯式使用:先 level=1 看结论,能判断就不深入;判断不了再升 level。",
    promptSnippet: "查看子 Agent 执行过程(默认最新总结,可逐级深入)",
    promptGuidelines: [
      "运行中:jsonl 不实时落盘,read_agent_log 读不到工具调用——用 list_agents 看当前工具/已调工具数",
      "完成后:jsonl 完整,read_agent_log 可靠(看结论/过程/复盘中止原因)",
      "先 level=1 看最新输出总结,能得出结论就不必看过程",
      "level=2 看工具执行清单(判断做了什么/卡在哪),level=3 全量仅排查用",
      "子 Agent 正常运行时不要查看过程(等完成通知);卡住/结果异常/用户询问时才看",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        delegation_id: { type: "string" as const, description: "委派 ID(list_agents 返回)" },
        index: { type: "number" as const, description: "任务序号(list_agents 返回)" },
        level: { type: "number" as const, description: "可选:1=最新输出总结(默认) 2=工具执行清单 3=全量过程" },
        tool_index: { type: "number" as const, description: "可选:与 level=2 搭配,查看第 N 次工具调用的输入输出(1 起)" },
      },
      required: ["delegation_id", "index"],
    },
    async execute(_tid: string, params: Record<string, unknown>) {
      // 查委派(含完成的):read_agent_log 要能回溯已完成的过程——不能只查 running
      const { getRunningDelegations, getDelegation } = await import("./task/registry");
      const did = String(params.delegation_id || "");
      const idx = Number(params.index);
      const level = Number(params.level) || 1;
      // 先查运行中(实时),再查全部(含完成)——前缀匹配
      const running = getRunningDelegations(sessionId).find((r) => r.delegationId.startsWith(did));
      let match = running;
      if (!match) {
        const rec = getDelegation(did);
        if (rec && (rec.parentSessionId === sessionId || rec.tempParentSessionId === sessionId)) match = rec;
      }
      if (!match) return { content: [{ type: "text" as const, text: `委派 ${did} 不存在或不属于当前会话` }] };
      const file = match.childSessionFiles[idx];
      if (!file) return { content: [{ type: "text" as const, text: `任务 ${idx} 尚未创建会话(jsonl 未生成)` }] };
      const { getSubagentMessages } = await import("./session-service");
      const msgs = await getSubagentMessages(file);
      if (msgs.length === 0) return { content: [{ type: "text" as const, text: "暂无已落盘的执行内容" }] };

      // 解析消息 content 块(主进程出口已归一化:toolCall→tool_use、arguments→input)
      // toolResult 是独立消息(role=toolResult):解析时把 tool_use 与紧随的 toolResult 合并,
      // 得到带输入输出的「工具事件」(tool_use 块带 result)
      const blocks: Array<{ type: string; text?: string; name?: string; input?: unknown; result?: string }> = [];
      for (const m of msgs) {
        const msg = m.message as Record<string, unknown>;
        const role = msg.role;
        const content = msg.content;
        if (!Array.isArray(content)) continue;
        for (const b of content as Array<Record<string, unknown>>) {
          if (typeof b?.type !== "string") continue;
          if (b.type === "tool_use") {
            blocks.push({ type: "tool_use", name: typeof b.name === "string" ? b.name : undefined, input: b.input });
          } else if (role === "toolResult" && b.type === "text") {
            // 工具结果:合并到最近一个无 result 的 tool_use 块
            const last = [...blocks].reverse().find((x) => x.type === "tool_use" && x.result === undefined);
            if (last) last.result = typeof b.text === "string" ? b.text : (b.content as string) ?? "";
            else blocks.push({ type: "tool_result_text", text: typeof b.text === "string" ? b.text : "" });
          } else {
            blocks.push({
              type: b.type,
              text: typeof b.text === "string" ? b.text : (b.thinking as string) ?? undefined,
              name: typeof b.name === "string" ? b.name : undefined,
              input: b.input,
            });
          }
        }
      }
      if (blocks.length === 0) return { content: [{ type: "text" as const, text: "已落盘但无解析内容" }] };

      if (level <= 1) {
        // level 1: 最新一条文本输出
        const lastText = [...blocks].reverse().find((b) => b.type === "text" && b.text?.trim());
        const text = lastText?.text?.trim() || "(暂无文本输出)";
        return { content: [{ type: "text" as const, text: `最新输出:\n${text.slice(0, 1000)}` }] };
      }

      const toolIndex = Number(params.tool_index);
      if (level === 2) {
        const tools = blocks.filter((b) => b.type === "tool_use");
        // tool_index 指定:查看第 N 次工具调用的完整输入输出
        if (toolIndex >= 1 && toolIndex <= tools.length) {
          const t = tools[toolIndex - 1]!;
          const inputStr = t.input !== undefined ? JSON.stringify(t.input) : "(无参数)";
          const resultStr = t.result ? t.result.slice(0, 2000) : "(运行中未落盘结果,完成后可查看)";
          return { content: [{ type: "text" as const, text: `第 ${toolIndex} 次工具调用:\n[${t.name || "?"}] 输入: ${inputStr}\n输出: ${resultStr}` }] };
        }
        // 默认:工具执行清单(序号 + 名 + 参数截断 + 结果首行)
        const lines: string[] = [];
        tools.forEach((t, i) => {
          if (i >= 20) return;
          const inputStr = t.input !== undefined ? JSON.stringify(t.input) : "";
          const resultHead = t.result ? ` → ${t.result.split("\n")[0]?.slice(0, 60) ?? ""}` : " → (结果未落盘)";
          lines.push(`${i + 1}. [${t.name || "?"}]${inputStr ? ` ${inputStr.slice(0, 120)}` : ""}${resultHead}`);
        });
        if (lines.length === 0) lines.push("(暂无工具调用)");
        return { content: [{ type: "text" as const, text: `工具执行(${tools.length} 条):\n${lines.join("\n")}\n\n提示: 指定 tool_index=N 查看第 N 次的完整输入输出` }] };
      }

      // level 3: 全量(思考+工具+输出)
      const lines: string[] = [];
      for (const b of blocks) {
        if (b.type === "thinking") lines.push(`[思考] ${(b.text || "").slice(0, 500)}`);
        else if (b.type === "tool_use") {
          // input 可能缺失(无参工具)→ JSON.stringify(undefined) 返回 undefined,需兜底
          const inputStr = b.input !== undefined ? JSON.stringify(b.input) : "";
          const resultStr = b.result ? `\n  输出: ${b.result.slice(0, 300)}` : "";
          lines.push(`[工具] ${b.name}: ${(inputStr || "").slice(0, 300)}${resultStr}`);
        }
        else if (b.type === "text" && b.text?.trim()) lines.push(`[输出] ${b.text.trim().slice(0, 500)}`);
      }
      const body = lines.join("\n").slice(0, 6000);
      return { content: [{ type: "text" as const, text: `执行过程:\n${body}` }] };
    },
  } as any) as ToolDefinition;
}

export class AgentService {
  private groupSessions: GroupSessionManager;
  constructor(private store: Store) {
    this.groupSessions = new GroupSessionManager({
      store,
      getAgentDir: () => this.getAgentDir(),
      buildGroupTools: (p, s, c, t) => this.buildGroupTools(p, s, c, t),
      buildSystemPrompt: (p, t, role, members) => this.groupSystemPrompt(p, t, role, members),
      resolveModel: (prov, mod) => this.getModel(this.store, prov, mod),
      broadcast: (ch, d) => broadcast(ch, d),
      injectSystemMessage: (sid, text, kind, opts) => this.injectSystemMessage(sid, text, kind, opts),
    });
  }
  private activeRuns: Map<string, ActiveRun> = new Map();
  private activeChats: Map<string, ActiveChat> = new Map();
  private runCounter = 0;
  private chatCounter = 0;
  onWorkerComplete: ((projectPath: string) => void) | null = null;
  private streamBuffer: Map<string, PiChatEvent[]> = new Map();
  /** 委派完成通知积压：Mint 忙碌时记下,回合结束后以新回合发送 */

  // ── 内部辅助 ──────────────────────────────────────

  private getAgentDir(): string {
    return path.join(os.homedir(), ".easymint", "agent");
  }

  private async getModel(store: Store, preferredProvider?: string, preferredModel?: string): Promise<Model<any> | null> {
    // 会话指定供应商+模型(需求 3/5)→ 优先用该供应商的模型
    if (preferredProvider && preferredModel) {
      const { getModelRuntime } = await import("./pi-init");
      const runtime = await getModelRuntime(store);
      const m = runtime.getModel(preferredProvider, preferredModel);
      if (m) return m as any;
    }
    // 默认/兜底降级(getActiveModel 内处理)
    return getActiveModel(store) ?? null;
  }

  private async buildExtraTools(projectPath: string, sessionId: string, chatId?: string): Promise<{
    tools: ToolDefinition[];
    canUseTool: CanUseToolFn;
  }> {
    // 权限回调：按 sessionId 隔离白名单，由 createPiSession 统一包装所有工具（含基础 coding 工具）
    // 放在 try 外——工具创建失败时同样返回回调，避免调用方 undefined（plan 只读仍生效）
    const canUseTool = permissionService.createCanUseTool(
      sessionId,
      (request) => { broadcast("agent:permission-request", request); },
      undefined,
      (askRequest) => { broadcast("agent:permission-request", { ...askRequest, type: "ask" }); },
    );

    try {
      const taskTool = await createTaskTool({
        cwd: projectPath,
        agentDir: this.getAgentDir(),
        store: this.store,
        parentSessionId: sessionId,
        chatId,
        // 委派收尾汇总 → 开回合让 Mint 自动响应总结(最后一条通知,无后续排队;
        // 委派过程的即时通知走 triggerTurn: false 路径不打断)
        onComplete: (sid, text) => this.injectSystemMessage(sid, text, "delegation", { triggerTurn: true }),
        // 单任务被用户停止 → 立即注入中止通知(kind: delegation,绿色气泡 ● 行);
        // 单任务委派被停止时 triggerTurn: true——无后续通知,开回合让 Mint 回应
        onTaskAborted: (sid, text, triggerTurn) => this.injectSystemMessage(sid, text, "delegation", triggerTurn ? { triggerTurn: true } : undefined),
        // 单任务提前完成 → 立即注入完成通知,Mint 输出判断继续等待(对齐 cc)
        onTaskCompleted: (sid, text) => this.injectSystemMessage(sid, text, "delegation"),
      });
      const productTools = await createProductTools(projectPath);
      const mcpTools = await loadMcpTools();
      const agentTemplateTool = await createAgentTemplateTool();
      const stopAgentTool = await createStopAgentTool(sessionId);
      const listAgentsTool = await createListAgentsTool(sessionId);
      const readAgentLogTool = await createReadAgentLogTool(sessionId);
      const allTools = [taskTool, agentTemplateTool, stopAgentTool, listAgentsTool, readAgentLogTool, ...productTools, ...mcpTools];

      return { tools: allTools, canUseTool };
    } catch (e) {
      console.error("[agent] tool creation failed:", e);
      return { tools: [], canUseTool };
    }
  }

  /** 群聊 Agent 工具集:由 AgentTemplate.tools 声明驱动(需求 4)。
      基础 coding 工具(Read/Write/Edit/Bash 等)由 createPiSession 强制追加;
      此处只注入模板声明的 task 委派工具与 MCP 工具。 */
  private async buildGroupTools(projectPath: string, sessionId: string, chatId: string | undefined, templateTools: string[]): Promise<{
    tools: ToolDefinition[];
    canUseTool: CanUseToolFn;
  }> {
    const canUseTool = permissionService.createCanUseTool(
      sessionId,
      (request) => { broadcast("agent:permission-request", request); },
      undefined,
      (askRequest) => { broadcast("agent:permission-request", { ...askRequest, type: "ask" }); },
    );
    try {
      const declared = new Set(templateTools ?? []);
      const tools: ToolDefinition[] = [];

      // task 委派工具:仅模板声明 task 时注入(群聊 Agent 默认无委派需求)
      if (declared.has("task")) {
        const taskTool = await createTaskTool({
          cwd: projectPath,
          agentDir: this.getAgentDir(),
          store: this.store,
          parentSessionId: sessionId,
          chatId,
          onComplete: (sid, text) => this.injectSystemMessage(sid, text, "delegation", { triggerTurn: true }),
          onTaskAborted: (sid, text, triggerTurn) => this.injectSystemMessage(sid, text, "delegation", triggerTurn ? { triggerTurn: true } : undefined),
          onTaskCompleted: (sid, text) => this.injectSystemMessage(sid, text, "delegation"),
        });
        tools.push(taskTool);
      }

      // MCP 工具:按模板声明的 mcp__* 过滤(如 mcp__codegraph__*)
      const declaredMcp = [...declared].filter((t) => t.startsWith("mcp__"));
      if (declaredMcp.length > 0) {
        const mcpTools = await loadMcpTools();
        tools.push(...mcpTools.filter((m) => declaredMcp.includes(m.name)));
      }

      console.log(`[group] 工具集(模板声明): task=${declared.has("task")} mcp=${declaredMcp.length}`);
      return { tools, canUseTool };
    } catch (e) {
      console.error("[group] 工具创建失败:", e);
      return { tools: [], canUseTool };
    }
  }

  private buildSystemPrompt(projectPath: string, isDesigner?: boolean): string {
    const parts: string[] = [];

    if (isDesigner) {
      parts.push(DESIGNER_AGENT_PROMPT);
    } else {
      const effective = resolveEffectivePrompt();
      if (effective) parts.push(effective);
    }

    const skills = buildSkillsPrompt(projectPath);
    if (skills) parts.push(skills);

    // 动态 section(借鉴 cc section 组装):项目环境 + 项目类型规范
    const env = buildProjectEnvSection(projectPath);
    if (env) parts.push(env);
    const profile = buildProjectProfileSection(readProjectProfile(projectPath));
    if (profile) parts.push(profile);

    return parts.join("\n\n");
  }

  /** 群聊 Agent 系统提示词:模板 prompt(替代默认 Mint prompt)+ 群聊协作规则 + 动态 section */
  private groupSystemPrompt(projectPath: string, templatePrompt: string, role?: string, members?: string): string {
    const parts: string[] = [];
    if (templatePrompt) {
      parts.push(templatePrompt);
    } else {
      const effective = resolveEffectivePrompt();
      if (effective) parts.push(effective);
    }
    // 替换协作规则占位符({members} 和 {role})
    const rule = GROUP_COLLABORATION_RULE
      .replace("{members}", members ?? "群聊成员(见上下文)")
      .replace("{role}", role ?? "成员");
    parts.push(rule);

    const skills = buildSkillsPrompt(projectPath);
    if (skills) parts.push(skills);
    const env = buildProjectEnvSection(projectPath);
    if (env) parts.push(env);
    const profile = buildProjectProfileSection(readProjectProfile(projectPath));
    if (profile) parts.push(profile);
    return parts.join("\n\n");
  }

  /** 处理 prompt → 广播流事件到前端，含压缩追踪和轮转 */
  private async promptAndBridge(
    session: AgentSession,
    sessionId: string,
    chatId: string,
    text: string,
    chat?: ActiveChat,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    systemPayload?: SystemMessagePayload,
  ): Promise<void> {
    let pendingResult: PiChatEvent | null = null;

    const unsub = session.subscribe((event: AgentSessionEvent) => {
      try {
        bridgeSessionEvents(event, {
          onEvent: (ev) => {
            ev.sessionId = sessionId;
            ev.chatId = chatId;
            broadcast("agent:stream", ev);
            this.bufferEvent(sessionId, ev);
          },
          getSession: () => session,
          setPendingResult: (ev: PiChatEvent) => { pendingResult = ev; },
        });

        // ── 压缩追踪 ──
        if (chat && event.type === "compaction_end") {
          if (!event.aborted && !event.willRetry) {
            chat.compactCount++;
            console.log(`[agent] compact #${chat.compactCount}: chatId=${chatId}`);

            // Pi 原生 compact 自带摘要（result.summary），保存供轮转交接。
            // 迁移时遗漏的填充逻辑——此前 summaryBuffer 恒为空，轮转从未真正执行。
            const nativeSummary = (event as { result?: { summary?: string } }).result?.summary;
            if (nativeSummary) chat.summaryBuffer = nativeSummary;

            if (chat.compactCount >= MAX_COMPACT && chat.contextStatus === "normal") {
              // 达到阈值 → 触发轮转（用 Pi 原生摘要交接）
              chat.contextStatus = "summarizing";
              console.log(`[agent] rotation triggered: chatId=${chatId}`);
            }
          }
        }
      } catch (e) {
        console.error("[agent] bridge error:", e);
      }
    });

    try {
      // 10 分钟超时保护，防止网络挂起无限阻塞
      const send = systemPayload
        ? session.sendCustomMessage(systemPayload, { triggerTurn: true })
        : session.prompt(text, images ? { images } : undefined);
      await Promise.race([
        send,
        new Promise((_, reject) => setTimeout(() => reject(new Error("请求超时（10分钟）")), 600_000)),
      ]);

      // (系统消息通知走 injectSystemMessage 的 triggerTurn: false 路径,不经此回合)
      const pr = pendingResult as PiChatEvent | null;
      if (pr) {
        pr.sessionId = sessionId;
        pr.chatId = chatId;
        broadcast("agent:stream", pr);
        this.bufferEvent(sessionId, pr);
        broadcast("agent:exit", { runId: chatId, code: 0 });

        // 上报真实上下文使用率
        setTimeout(() => {
          const usage = session.getContextUsage();
          if (usage) {
            broadcast("agent:context-usage", {
              chatId,
              percentage: usage.percent ?? 0,
              totalTokens: usage.tokens ?? 0,
              maxTokens: usage.contextWindow,
            });
          }
        }, 500);

        // ── 自动标题：新会话首轮完成后生成中文标题 ──
        // (系统消息作为首条时 firstUserMessage 已置空,不生成标题)
        if (chat && chat.firstUserMessage) {
          const firstMsg = chat.firstUserMessage;
          chat.firstUserMessage = "";
          const isNamed = await hasCustomTitle(sessionId, chat.projectPath);
          if (!isNamed) {
            const title = firstMsg.length > 15 ? firstMsg.slice(0, 15) + "…" : firstMsg;
            renameSession(sessionId, title, chat.projectPath).catch(() => {});
            broadcast("agent:session-renamed", { sessionId, title });
          }
        }

        // ── 轮转收尾：summarizing 完成 → 归档 + 新会话 ──
        if (chat && chat.contextStatus === "summarizing") {
          await finishRotation(chat, session, sessionId, {
            store: this.store,
            getModel: () => this.getModel(this.store),
            getAgentDir: () => this.getAgentDir(),
            buildSystemPrompt: (p, d) => this.buildSystemPrompt(p, d),
            buildExtraTools: (p, s) => this.buildExtraTools(p, s),
            promptAndBridge: (sess, sid, cid, text, c, images, payload) => this.promptAndBridge(sess, sid, cid, text, c, images, payload),
          });
          return; // 轮转完成，不继续
        }
      }
    } catch (err: unknown) {
      const msg = normalizeApiError(err);
      console.error(`[agent] prompt error: chatId=${chatId}`, err instanceof Error ? err.message : String(err));
      broadcast("agent:stream", { type: "error", sessionId, chatId, message: msg, canRetry: false });
      broadcast("agent:exit", { runId: chatId, code: -1 });
    } finally {
      unsub();
    }
  }

  // ── Worker（one-shot，接口保持） ──────────────────

  async runWorker(
    projectPath: string,
    prompt: string,
    _mainWindow: BrowserWindow,
  ): Promise<{ runId: string }> {
    const runId = `run-${++this.runCounter}`;
    const abortController = new AbortController();
    const run: ActiveRun = { runId, session: null, abortController };
    this.activeRuns.set(runId, run);

    (async () => {
      try {
        const resolvedPath = path.resolve(resolveHome(projectPath));
        const model = await this.getModel(this.store);
        if (!model) {
          broadcast("agent:stderr", { runId, data: "未配置 AI 模型，请在设置中配置 API", timestamp: Date.now() });
          broadcast("agent:exit", { runId, code: -1 });
          this.activeRuns.delete(runId);
          return;
        }

        const { tools: extraTools, canUseTool } = await this.buildExtraTools(resolvedPath, runId);
        const session = await createPiSession({
          cwd: resolvedPath,
          agentDir: this.getAgentDir(),
          model,
          thinkingLevel: "medium",
          store: this.store,
          systemPrompt: this.buildSystemPrompt(resolvedPath),
          extraTools,
          canUseTool,
        });
        run.session = session;

        await this.promptAndBridge(session, "", runId, prompt); // worker 无 chat

        broadcast("agent:exit", { runId, code: 0 });
        if (this.onWorkerComplete) this.onWorkerComplete(projectPath);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        broadcast("agent:stderr", { runId, data: msg, timestamp: Date.now() });
        broadcast("agent:exit", { runId, code: -1 });
      } finally {
        this.activeRuns.delete(runId);
      }
    })().catch((e) => {
      console.error("[agent] runWorker 未预期错误:", (e as Error).message);
    });

    return { runId };
  }

  abort(runId: string): void {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.abortController.abort();
      run.session?.abort().catch(() => {});
      this.activeRuns.delete(runId);
    }
    // chat 会话：打断按钮只停主会话回合,子 Agent 继续后台执行(用户通过 ProcessBar 单独停止)
    // runId 可能是 chatId（前端打断按钮）或 sessionId（steer/其他）——先按 sessionId 查，再按 chatId 兜底
    let chat = this.findActiveChat(runId);
    if (!chat) {
      for (const [, c] of this.activeChats) {
        if (c.chatId === runId) { chat = c; break; }
      }
    }
    if (chat) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
    }
  }


// ── Chat（长生命周期会话） ─────────────────────────

  /**
   * 发送聊天消息。如果 resumeSessionId 对应的会话已活跃 → 继续在该 session 上 prompt；
   * 否则创建新会话。
   */
  async sendMessage(
    projectPath: string,
    message: string,
    resumeSessionId: string | null,
    permissionMode: string | undefined,
    mainWindow: BrowserWindow,
    model?: string,
    isDesigner?: boolean,
    images?: Array<{ type: "image"; data: string; mimeType: string }>,
    thinkingLevel?: string,
    systemPayload?: SystemMessagePayload,
    /** 会话指定供应商(需求 5:不同会话不同供应商;与 model 搭配创建会话) */
    preferredProvider?: string,
  ): Promise<{ chatId: string }> {
    const resolvedPath = path.resolve(resolveHome(projectPath));

    // 已有活跃会话 → 直接用
    if (resumeSessionId) {
      const existing = this.findActiveChat(resumeSessionId);
      if (existing && existing.session) {
        this.promptAndBridge(existing.session, resumeSessionId, existing.chatId, message, existing, images, systemPayload);
        return { chatId: existing.chatId };
      }
    }

    // 新会话
    const chatId = `chat-${++this.chatCounter}`;
    const piModel = await this.getModel(this.store, preferredProvider, model);
    if (!piModel) {
      throw new Error("未配置 AI 模型，请在设置中配置 API");
    }

    // 验证 API Key 已配置
    if (!this.store.getActiveApiKey()) {
      console.warn("[agent] 未检测到有效的 API Key，请求可能失败");
    }

    // 恢复会话时补全 isDesigner：tab 恢复不会带此标记，从持久化的 session 类型中读取
    const designer = isDesigner || sessionAgentTypes.get(resumeSessionId ?? "") === "designer";

    // 新会话用临时 ID（task 工具绑定它），真实 sessionId 在 createPiSession 返回后更新
    const newSessionId = randomUUID();

    // 新建与恢复会话统一注入工具（历史实现恢复分支留空 → 恢复会话无 task/产品工具、无权限控制）
    const { tools: extraTools, canUseTool } = await this.buildExtraTools(
      resolvedPath,
      resumeSessionId ?? newSessionId,
      chatId,
    );

    // 后台 shell 退出 → 结果注入主会话(临时 ID 解析为真实 ID,同 task 委派)
    // 每条 shell 通知都开回合让 Mint 回应:shell 命令是独立工作(无批次关联),
    // 退出通知 = 该工作的最终通知,对应 agent 单任务委派=汇总必回应的原则
    // (命令跑得久,退出时回合已结束;不开回合则 Mint 永远不会读到并回应)
    const shellExitInject = (shell: BackgroundShell): void => {
      const sid = resolveParentSessionId(resumeSessionId ?? newSessionId);
      this.injectSystemMessage(sid, formatShellResult(shell), "shell", { triggerTurn: true });
    };

    const session: AgentSession = await (async () => {
      if (resumeSessionId) {
        const sessions = await listPiSessions(resolvedPath);
        const info = sessions.find((s) => s.id === resumeSessionId);
        if (info) {
          return resumePiSession({
            cwd: resolvedPath,
            agentDir: this.getAgentDir(),
            model: piModel,
            store: this.store,
            resumeSessionFile: info.path,
            systemPrompt: this.buildSystemPrompt(resolvedPath, designer),
            extraTools,
            canUseTool,
            onShellExit: shellExitInject,
          });
        }
        console.warn(`[agent] resume NOT found: ${resumeSessionId} (共 ${sessions.length} 个会话)——将新建会话`);
      }
      return createPiSession({
        cwd: resolvedPath,
        agentDir: this.getAgentDir(),
        model: piModel,
        store: this.store,
        systemPrompt: this.buildSystemPrompt(resolvedPath, designer),
        extraTools,
        canUseTool,
        onShellExit: shellExitInject,
      });
    })();

    // 注册临时 ID → 真实 ID 映射：task 委派创建时解析,按真实 ID 建子会话目录
    if (!resumeSessionId) {
      registerSessionIdMapping(newSessionId, session.sessionId);
    }

    const chat: ActiveChat = {
      chatId,
      sessionId: resumeSessionId ?? session.sessionId,
      tempSessionId: resumeSessionId ? undefined : newSessionId,
      session,
      abortController: new AbortController(),
      projectPath: resolvedPath,
      agentType: undefined,
      status: "idle",
      // 系统消息(custom payload)作为首条时,用 kind 中文标签作标题——
      // SDK 的 buildSessionInfo 过滤 custom 角色消息,不兜底会显示 "(no messages)"
      firstUserMessage: systemPayload
        ? (SYSTEM_KIND_TITLES[systemPayload.details.kind as string] ?? "系统消息")
        : message,
      assistantUuid: randomUUID(),
      eventBuffer: [],
      compactCount: 0,
      contextStatus: "normal",
      summaryBuffer: "",
      rotationContinuation: "",
    };

    if (isDesigner) {
      chat.agentType = "designer";
      if (resolvedPath) {
        const resourcesDir = path.join(__dirname, "..", "..", "..", "resources");
        const templateDir = path.join(resourcesDir, "em-html-editor");
        const brandDir = path.join(resourcesDir, "brand-tokens");
        const destTemplateDir = path.join(resolveHome(resolvedPath), ".easymint", "templates");
        const destBrandDir = path.join(resolveHome(resolvedPath), ".easymint", "brand-tokens");
        const templateFiles = [
          "template-landing.html", "template-dashboard.html",
          "template-form.html", "template-detail.html",
        ];
        try {
          fs.mkdirSync(destTemplateDir, { recursive: true });
          for (const f of templateFiles) {
            const src = path.join(templateDir, f);
            if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destTemplateDir, f));
          }
          if (fs.existsSync(brandDir)) {
            fs.cpSync(brandDir, destBrandDir, { recursive: true });
          }
        } catch (e) { console.warn("[agent] 复制模板/品牌文件失败:", (e as Error).message); }
      }
    }

    this.activeChats.set(chatId, chat);

    // 记录 agent 类型
    if (chat.agentType && chat.sessionId) {
      sessionAgentTypes.set(chat.sessionId, chat.agentType);
      saveSessionTypes(sessionAgentTypes);
    }

    // 广播 session_id（前端需要）
    if (chat.sessionId) {
      broadcast("agent:chat-session", { chatId, sessionId: chat.sessionId });
    }

    // 设置思考级别（在 prompt 前同步设置，避免竞态）
    if (thinkingLevel) {
      try { session.setThinkingLevel(thinkingLevel as any); }
      catch (e) { console.warn("[agent] setThinkingLevel 失败:", (e as Error).message); }
    }

    // 发起第一轮对话
    this.promptAndBridge(session, chat.sessionId, chatId, message, chat, images, systemPayload);

    return { chatId };
  }

  findActiveChat(sessionId: string): ActiveChat | undefined {
    for (const [, chat] of this.activeChats) {
      // 双键匹配：task 工具绑定的 EM 临时 ID（tempSessionId）与对外 Pi 真实 ID（sessionId）
      if (chat.sessionId === sessionId || chat.tempSessionId === sessionId) return chat;
    }
    return undefined;
  }

  getChatStatus(sessionId: string): string {
    const chat = this.findActiveChat(sessionId);
    return chat?.status ?? "idle";
  }

  private bufferEvent(key: string, event: PiChatEvent): void {
    let buf = this.streamBuffer.get(key);
    if (!buf) {
      buf = [];
      this.streamBuffer.set(key, buf);
    }
    buf.push(event);
    if (buf.length > 500) buf.splice(0, buf.length - 500);
  }

  getBufferedStream(sessionId: string): unknown[] {
    const events: unknown[] = this.streamBuffer.get(sessionId) ?? [];
    this.streamBuffer.delete(sessionId);
    const chat = this.findActiveChat(sessionId);
    if (chat) {
      const chatEvents = this.streamBuffer.get(chat.chatId) ?? [];
      this.streamBuffer.delete(chat.chatId);
      events.push(...chatEvents);
    }
    return events;
  }

  async setModel(sessionId: string, modelName: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return;
    // 按用户选的模型名直接找 Model 对象热切（不依赖"当前供应商默认模型"比较——
    // 原实现选非默认模型时 id 不匹配走 resetModelRuntime，实际没切到所选模型）
    const { getModelRuntime } = await import("./pi-init");
    const runtime = await getModelRuntime(this.store);
    const settings = this.store.getSettings();
    const providers = settings.apiProviders;
    const activeCfg = providers?.configs?.[providers?.current ?? ""];
    if (!activeCfg || !providers?.current) return;
    const provider = activeCfg.presetId === "custom" ? providers.current : activeCfg.presetId;
    const model = runtime.getModel(provider, modelName);
    if (model) {
      await chat.session.setModel(model as any);
      chat.currentModel = modelName;
    } else {
      // 模型不在运行时（新供应商 apiKey 未注册）→ 重建运行时（重建时全量 sync 配置）
      resetModelRuntime();
    }
  }


  async spawnAgentChat(
    projectPath: string,
    templateId: string,
    message: string,
  ): Promise<{ chatId: string }> {
    return this.sendMessage(projectPath, message, null, "auto",
      _mainWindow!,
      undefined, false);
  }

  // ── 群聊会话(需求 4:多 Agent 同一会话,应用层消息转发) ──

  /** 创建群聊:每个模板建独立 Pi session,首条消息发主 Agent */
  createGroupChat(
    projectPath: string,
    templateIds: string[],
    opts?: { presetId?: string; message?: string; permissionMode?: string; thinkingLevel?: string },
  ): Promise<{ groupId: string; chatId: string }> {
    return this.groupSessions.createGroup(projectPath, templateIds, opts);
  }

  /** 群聊发消息:@提及路由到目标 Agent,否则主 Agent */
  sendGroupMessage(groupId: string, text: string): Promise<void> {
    return this.groupSessions.sendGroupMessage(groupId, text);
  }

  /** 项目群聊列表(持久化 meta) */
  listGroupChats(projectPath: string): GroupSessionMeta[] {
    return this.groupSessions.listGroups(projectPath);
  }

  /** 读取群聊记录(UI 显示历史) */
  getGroupRecord(projectPath: string, groupId: string): GroupRecord {
    return this.groupSessions.getRecord(projectPath, groupId);
  }

  /** 关闭群聊(释放所有 Agent 会话) */
  closeGroupChat(groupId: string): void {
    this.groupSessions.closeGroup(groupId);
  }

  killChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (chat) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
      chat.session?.dispose();
      permissionService.clearSessionWhitelist(chat.sessionId);
      permissionService.clearSessionPending(chat.sessionId);
      this.activeChats.delete(chatId);
      this.cancelReclaim(chat.sessionId);
      // 会话关闭广播:前端会话列表状态点刷新(激活→未激活)
      broadcast("agent:chat-closed", { sessionId: chat.sessionId });
    }
  }

  /** 按 sessionId 立即结束会话(右键「结束会话」,用户明确点击不做延迟) */
  killSession(sessionId: string): void {
    const chat = this.findActiveChat(sessionId);
    if (chat) this.killChat(chat.chatId);
  }

  /** 活跃会话 sessionId 列表(会话列表状态点用) */
  listActiveSessions(): string[] {
    return Array.from(this.activeChats.values()).map((c) => c.sessionId).filter(Boolean) as string[];
  }

  /** 关闭 tab 后的会话回收记录(按 sessionId 防重复) */
  private reclaims = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * 关闭 tab → 会话保留 2 分钟,2 分钟后直接 killChat(不做活跃判断——
   * 关闭 tab 时已有活跃事件提示,用户仍关闭 = 不在意)。重开 tab 时前端调 cancelReclaim 取消。
   */
  reclaimChat(sessionId: string): void {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return;
    if (this.reclaims.has(sessionId)) return;
    const timer = setTimeout(() => this.finishReclaim(sessionId), 2 * 60 * 1000);
    this.reclaims.set(sessionId, timer);
  }

  cancelReclaim(sessionId: string): void {
    const t = this.reclaims.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.reclaims.delete(sessionId);
    }
  }

  private finishReclaim(sessionId: string): void {
    this.cancelReclaim(sessionId);
    const chat = this.findActiveChat(sessionId);
    if (chat) this.killChat(chat.chatId);
  }

  scheduleIdleTimeout(_sessionId: string, _delayMs: number): void {
    // Pi 会话不同于 Claude SDK 的 query 进程，无需 idle timeout
    // 保留接口兼容性
  }

  private cancelIdleTimeout(_sessionId: string): void {
    // Pi 无需
  }

  onSessionRenamed(sessionId: string): void {
    const chat = this.findActiveChat(sessionId);
    if (chat) chat.firstUserMessage = "";
  }

  /** 查询 session 真实流状态——前端 busy 卡住时的兜底 */
  isStreaming(sessionId: string): boolean {
    const chat = this.findActiveChat(sessionId);
    return chat?.session?.isStreaming ?? false;
  }

  /** 获取会话统计（token 消耗、费用等）——活跃会话走内存，磁盘会话直接读 JSONL */
  async getSessionStats(sessionId: string, projectPath?: string): Promise<Record<string, unknown> | null> {
    // 1. 活跃会话：直接用 Pi 的 getSessionStats
    const chat = this.findActiveChat(sessionId);
    if (chat?.session) {
      try {
        const stats = chat.session.getSessionStats();
        return {
          sessionId: stats.sessionId, sessionFile: stats.sessionFile,
          userMessages: stats.userMessages, assistantMessages: stats.assistantMessages,
          toolCalls: stats.toolCalls, totalMessages: stats.totalMessages,
          tokens: stats.tokens, cost: stats.cost, contextUsage: stats.contextUsage,
          // 当前模型(前端按 provider 判断 cost 币种:DeepSeek=¥, 其他=$)
          model: chat.currentModel ?? undefined,
        };
      } catch { /* fall through to disk read */ }
    }

    // 2. 磁盘会话：直接读 JSONL 统计
    if (!projectPath) return null;
    try {
      const { listPiSessions, getPiSessionDir } = await import("./pi-session");
      const { getSessionManagerClass } = await import("./pi-sdk");
      const resolved = path.resolve(resolveHome(projectPath));
      const sessions = await listPiSessions(resolved);
      const info = sessions.find((s) => s.id === sessionId);
      if (!info) return null;

      const SM = await getSessionManagerClass();
      const mgr = SM.open(info.path, getPiSessionDir(resolved), resolved);
      const entries = mgr.getEntries();

      let userMessages = 0, assistantMessages = 0, toolCalls = 0, totalMessages = 0;
      let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheWrite = 0;

      for (const entry of entries) {
        if (entry.type !== "message") continue;
        totalMessages++;
        const msg = entry.message as unknown as Record<string, unknown>;
        if (msg.role === "user") userMessages++;
        else if (msg.role === "assistant") {
          assistantMessages++;
          const usage = (msg as any).usage;
          if (usage) {
            inputTokens += usage.input ?? 0;
            outputTokens += usage.output ?? 0;
            cacheRead += usage.cacheRead ?? usage.cacheCreation?.[""] ?? 0;
            cacheWrite += usage.cacheWrite ?? 0;
          }
          const content = msg.content as Array<{ type: string }> | undefined;
          if (content) {
            for (const block of content) {
              if (block.type === "toolCall") toolCalls++;
            }
          }
        }
      }

      return {
        sessionId, sessionFile: info.path,
        userMessages, assistantMessages, toolCalls, totalMessages,
        tokens: { input: inputTokens, output: outputTokens, cacheRead, cacheWrite, total: inputTokens + outputTokens + cacheRead + cacheWrite },
        cost: 0, // 磁盘统计不计算费用（需模型定价信息）
      };
    } catch (e) {
      console.error("[agent] getSessionStats disk read failed:", e);
      return null;
    }
  }

  async peekUsage(_projectPath: string, sessionId: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (chat?.session) {
      const usage = chat.session.getContextUsage();
      if (usage) {
        broadcast("agent:context-usage", {
          chatId: sessionId,
          percentage: usage.percent ?? 0,
          totalTokens: usage.tokens ?? 0,
          maxTokens: usage.contextWindow,
        });
        return;
      }
    }
    broadcast("agent:context-usage", { chatId: sessionId, percentage: 0, totalTokens: 0, maxTokens: 0 });
  }

  // ── Pi 原生支持的操作 ─────────────────────────────

  /** 注入引导消息（中断当前回合并插话） */
  /** 停止委派中的单个任务(ProcessBar 点击停止) */
  async stopDelegationTask(delegationId: string, taskIndex: number): Promise<void> {
    abortTask(delegationId, taskIndex);
    broadcast("agent:delegation-count", getRunningSummary());
  }

  async steer(sessionId: string, text: string): Promise<void> {
    // 插话 = 软打断：Mint 响应新消息,运行中的子 Agent 继续后台执行（对齐 cc 实测行为）
    const chat = this.findActiveChat(sessionId);
    await chat?.session?.steer(text);
  }

  /**
   * 注入系统消息（委派完成/后台 shell 通知）
   * 默认 triggerTurn: false——立即落盘 + 立即 message_start/end 事件,不开回合。
   * 通知独立即时显示(按完成时序),不等待回合、不挂靠消息;Mint 回合由
   * 后续消息/活动驱动,通知已在上下文中自然读到。
   * opts.triggerTurn: true 用于委派收尾的汇总通知——开回合让 Mint 自动响应总结
   * (最后一条通知,无后续排队;委派过程通知保持 false 即时显示不打断)。
   */
  injectSystemMessage(sessionId: string, text: string, kind: SystemMessageKind = "delegation", opts?: { triggerTurn?: boolean }): void {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return;
    // content 保留 [系统消息] 前缀(模型侧识别);结构身份走 customType/kind(JSONL/事件/前端)
    const payload = systemMessage(kind, `[系统消息]-[Agent执行结果]\n${text}`);
    // 一次性事件桥:sendCustomMessage 的 message_start/end 事件同步触发,
    // 广播到前端(custom_event);无回合,广播完即退订
    const unsub = chat.session.subscribe((event: AgentSessionEvent) => {
      try {
        bridgeSessionEvents(event, {
          onEvent: (ev) => {
            ev.sessionId = sessionId;
            ev.chatId = chat.chatId;
            broadcast("agent:stream", ev);
            this.bufferEvent(sessionId, ev);
          },
          getSession: () => chat.session,
          // triggerTurn: true 的汇总回合结束(agent_end → turn_end)时广播 agent:exit——
          // 否则前端 busy 残留(打断按钮卡住),且后续消息误走 steer 路径发送失败
          setPendingResult: (ev) => {
            if (ev.type === "turn_end") {
              broadcast("agent:exit", { runId: chat.chatId, code: 0 });
            }
          },
        });
      } catch (e) {
        console.error("[agent] system message bridge error:", e);
      }
    });
    chat.session.sendCustomMessage(payload, opts?.triggerTurn ? { triggerTurn: true } : undefined).catch((e) => {
      console.error("[agent] sendCustomMessage failed:", (e as Error).message);
    }).finally(() => unsub());
  }

  /** 注入跟进消息（当前回合结束后发送） */
  async followUp(sessionId: string, text: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    await chat?.session?.followUp(text);
  }

  /** 手动压缩上下文 */
  async compact(sessionId: string, instructions?: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (chat?.session) {
      broadcast("agent:context-summarizing", { chatId: chat.chatId, type: "compact" });
      await chat.session.compact(instructions);
    }
  }

  /** 切换思考级别 */
  setThinkingLevel(sessionId: string, level: string): void {
    const chat = this.findActiveChat(sessionId);
    chat?.session?.setThinkingLevel(level as any);
  }

  /** 循环切换模型 */
  async cycleModel(sessionId: string, direction: "forward" | "backward" = "forward"): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return;
    const result = await chat.session.cycleModel(direction);
    if (result) {
      chat.currentModel = result.model.id;
      broadcast("agent:model-changed", { sessionId, model: result.model.id });
    }
  }

  /** 运行时切换活跃工具集 */
  setActiveTools(sessionId: string, toolNames: string[]): void {
    const chat = this.findActiveChat(sessionId);
    chat?.session?.setActiveToolsByName(toolNames);
  }

  shutdown(): void {
    for (const [id, chat] of this.activeChats) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
      chat.session?.dispose();
      permissionService.clearSessionWhitelist(chat.sessionId);
      permissionService.clearSessionPending(chat.sessionId);
      broadcast("agent:exit", { runId: id, code: -1 });
    }
    this.activeChats.clear();
    for (const [id, run] of this.activeRuns) {
      run.abortController.abort();
      run.session?.abort().catch(() => {});
      broadcast("agent:exit", { runId: id, code: -1 });
    }
    this.activeRuns.clear();
    // 清理全部后台 shell 进程(杀进程树,防孤儿进程)
    backgroundShellRegistry.stopAll();
  }
}

// ── setMainWindow ────────────────────────────────────

let _mainWindow: BrowserWindow | null = null;
export function setMainWindow(win?: BrowserWindow): void {
  if (win) _mainWindow = win;
}

