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
import { resolveHome, getResourcesDir } from "../utils/paths";
import { broadcast } from "./ipc-broadcast";
import { Store } from "./store";
import { resolveEffectivePrompt } from "./system-prompt-manager";
import { getActiveModel, resetModelRuntime } from "./pi-init";
import { createPiSession, resumePiSession, listPiSessions } from "./pi-session";
import { createTaskTool } from "./task/tool";
import { createAgentTemplateTool } from "./task/tool";
import { createSkillTool, createManageSkillTool } from "./tools/skill-tool";
import { createLearnTool, createSearchExperiencesTool, type LearnResponse } from "./tools/learn-tool";
import { evaluateLearnGate, isFixTool } from "./learn-gate";
import { searchExperiences, buildExperienceInjection } from "./experience-service";
import { createImportTools } from "./import-tools";
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
import { buildProjectEnvSection, buildProjectProfileSection, readProjectProfile } from "./prompt-sections";
import { MINT_DESIGN_BOOST } from "../../shared/prompts";

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
  learn: "经验沉淀",
};

interface ActiveRun {
  runId: string;
  session: AgentSession | null;
  abortController: AbortController;
}

export interface ActiveChat {
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
  /** 本会话已 compact 次数（轮转取消后仅统计用） */
  compactCount: number;
  /** learn 触发控制（期3）：本轮（单轮）信号累计 + 每会话一次防重 */
  toolCallCount: number;
  /** 本轮是否出现过工具报错（与 learnFixAfterError 构成「错误-修复对」） */
  learnErrorSeen: boolean;
  /** 报错之后是否出现过修复动作（write/edit/bash 类） */
  learnFixAfterError: boolean;
  /** 本轮最近一次工具报错的文本摘录（≤150 字符，供经验回递检索） */
  learnErrorText: string;
  learnSuggestDone: boolean;
  /** learn/search_experiences 是否已注册（会话创建时快照——工具集固定于创建时，触发提示按此判断） */
  learnToolInstalled: boolean;
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

/** 删除项目时清除其会话的 agent 类型记录（内存 + 磁盘） */
export function removeSessionTypes(sids: string[]): void {
  let changed = false;
  for (const sid of sids) {
    if (sessionAgentTypes.delete(sid)) changed = true;
  }
  if (changed) saveSessionTypes(sessionAgentTypes);
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

// ── ask_user 结构化提问（Mint → 用户点选） ──────────────

/** 挂起的 ask_user 请求：工具 execute 等待用户回答（回合暂停） */
interface PendingAsk {
  resolve: (text: string) => void;
  sessionId: string;
  questions: Array<{ id: string; question: string }>;
}

const pendingAsks = new Map<string, PendingAsk>();

/** 响应 ask_user（IPC handler 调用）。answers 为 null/空 = 用户取消。
 *  返回 requestId 对应 sessionId（前端按此过滤），未找到返回 null */
export function respondAsk(requestId: string, answers: Array<{ questionId: string; values: string[] }> | null): string | null {
  const pending = pendingAsks.get(requestId);
  if (!pending) return null;
  pendingAsks.delete(requestId);
  if (!answers || answers.length === 0) {
    pending.resolve("（用户取消了提问，未作答）");
  } else {
    const byId = new Map(pending.questions.map((q) => [q.id, q.question]));
    const lines = answers.map((a) => `- ${byId.get(a.questionId) ?? a.questionId}: ${a.values.join("、")}`);
    pending.resolve(`用户回答：\n${lines.join("\n")}`);
  }
  broadcast("agent:ask-closed", { requestId });
  return pending.sessionId;
}

/** 清理某会话的全部挂起 ask（会话关闭兜底；正常路径走 abort 信号） */
export function clearPendingAsks(sessionId: string): void {
  for (const [id, p] of pendingAsks) {
    if (p.sessionId !== sessionId) continue;
    pendingAsks.delete(id);
    p.resolve("（提问已取消：会话已关闭）");
    broadcast("agent:ask-closed", { requestId: id });
  }
}

// ── learn 审阅挂起（Mint 沉淀 → 用户审阅卡片确认） ──────────

interface PendingLearn {
  resolve: (r: LearnResponse) => void;
  sessionId: string;
}

const pendingLearns = new Map<string, PendingLearn>();

/** 响应 learn 审阅（IPC learn:respond 调用）。返回 sessionId 供前端过滤，未找到返回 null */
export function respondLearn(requestId: string, response: unknown): string | null {
  const pending = pendingLearns.get(requestId);
  if (!pending) return null;
  // IPC 载荷校验：approved 必须是 boolean，编辑字段必须是 string/undefined
  const r = response as { approved?: unknown; memory?: unknown; skillBody?: unknown; skillName?: unknown; skillDescription?: unknown };
  if (typeof r?.approved !== "boolean") return null;
  const clean: LearnResponse = { approved: r.approved };
  for (const k of ["memory", "skillBody", "skillName", "skillDescription"] as const) {
    const v = r[k];
    if (v !== undefined && typeof v === "string") clean[k] = v;
  }
  pendingLearns.delete(requestId);
  pending.resolve(clean);
  broadcast("agent:learn-closed", { requestId });
  return pending.sessionId;
}

/** 清理某会话的全部挂起 learn（会话关闭兜底；正常路径走 abort 信号 / 用户取消） */
export function clearPendingLearns(sessionId: string): void {
  for (const [id, p] of pendingLearns) {
    if (p.sessionId !== sessionId) continue;
    pendingLearns.delete(id);
    p.resolve({ approved: false });
    broadcast("agent:learn-closed", { requestId: id });
  }
}

// ── learn 触发状态持久化（重启后不重复提示/建议，防重复沉淀） ──────────

interface LearnSessionState {
  suggestDone?: boolean;
}

const LEARN_STATE_PATH = path.join(os.homedir(), ".easymint", "learn-state.json");

function loadLearnStates(): Record<string, LearnSessionState> {
  try {
    if (fs.existsSync(LEARN_STATE_PATH)) {
      const data: unknown = JSON.parse(fs.readFileSync(LEARN_STATE_PATH, "utf-8"));
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return data as Record<string, LearnSessionState>;
      }
    }
  } catch (e) {
    console.warn("[agent] learn-state 读取失败（按无状态处理）:", (e as Error).message);
  }
  return {};
}

function saveLearnState(sessionId: string, state: LearnSessionState): void {
  try {
    const states = loadLearnStates();
    states[sessionId] = state;
    // 原子写（temp+rename）：崩溃半截不会让 learn-state 变损坏——
    // 损坏时 loadLearnStates 按无状态处理，会破坏「每会话一次提示」的去重
    const tmp = LEARN_STATE_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(states, null, 2));
    fs.renameSync(tmp, LEARN_STATE_PATH);
  } catch (e) {
    console.warn("[agent] learn-state 写入失败:", (e as Error).message);
  }
}

/** Mint 向用户结构化提问工具：问题 + 选项点选 + 自定义输入（支持多选与级联联动）。
 *  execute 挂起等待用户回答（run 级 signal 仅显式 abort 触发，正常回合等待安全），
 *  用户答后结果以文本返回，Mint 据此继续推进 */
async function createAskUserTool(sessionId: string): Promise<ToolDefinition> {
  const defineTool = await getDefineToolFn();
  return defineTool({
    name: "ask_user",
    label: "向用户提问",
    description:
      "向用户提出结构化选择题（可多个问题，每题单选，支持级联联动）。调用后回合暂停等待用户回答。"
      + "适用场景：方案对比选择、范围取舍确认、让用户从候选中拍板等需要用户决策的时刻。"
      + "选项要精炼：label 简短（≤10 字）+ 说明放选项括号里；每题 2-4 个选项为宜。",
    promptSnippet: "向用户提问（选择题/级联）",
    promptGuidelines: [
      "触发场景分层：应该用——新功能设计（需求拆解、功能范围、交互/视觉选择）、方案调整（技术选型、实现方式、取舍权衡）；不应该用——修 bug（目标明确的修复直接执行）、简单确认（继续吗/这样可以吗用文本即可）",
      "例外：修复方案存在重大分叉（两种修法路线不同）才问；选项互斥要清晰；级联问题用 depends_on 关联前置问题的选项值",
      "调用后回合暂停等待用户回答，回答会作为工具结果返回，据此继续推进",
      "用户跳过或取消时结果会说明，可换一种方式再问或继续推进",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        questions: {
          type: "array" as const,
          description: "问题数组（按顺序展示；depends_on 未满足的问题隐藏，前置选择变化时动态出现）",
          items: {
            type: "object" as const,
            properties: {
              id: { type: "string" as const, description: "问题唯一标识（答案中按此返回）" },
              question: { type: "string" as const, description: "问题文本" },
              options: {
                type: "array" as const,
                description: "选项列表（省略则仅自定义输入模式）",
                items: {
                  type: "object" as const,
                  properties: {
                    value: { type: "string" as const, description: "选项值（答案中返回）" },
                    label: { type: "string" as const, description: "选项显示文本（简短）" },
                    description: { type: "string" as const, description: "选项补充说明（一句）" },
                  },
                  required: ["value", "label"],
                },
              },
              multi_select: { type: "boolean" as const, description: "是否多选（默认 false）" },
              depends_on: {
                type: "object" as const,
                description: "级联条件：{前置问题id: 选项value}，前置选择匹配才显示本问题",
                additionalProperties: { type: "string" as const },
              },
            },
            required: ["id", "question"],
          },
        },
        allow_custom: { type: "boolean" as const, description: "是否允许用户直接输入自定义答案（默认 true）" },
      },
      required: ["questions"],
    },
    async execute(_tid: string, params: Record<string, unknown>, signal: AbortSignal | undefined) {
      const rawQuestions = params.questions;
      if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        return { content: [{ type: "text" as const, text: "ask_user 参数错误：questions 必须是非空数组" }] };
      }
      const questions = rawQuestions.map((q) => q as Record<string, unknown>);
      if (questions.some((q) => typeof q.id !== "string" || typeof q.question !== "string")) {
        return { content: [{ type: "text" as const, text: "ask_user 参数错误：每个问题必须含 id(string) 和 question(string)" }] };
      }
      const requestId = randomUUID();
      // 新会话时工具闭包绑定的 sessionId 是临时 UUID（buildExtraTools 时尚未创建 Pi 会话），
      // 前端 sid 已迁移为真实 ID——广播前解析为真实 ID（同委派通知机制），否则前端会话过滤不匹配
      const realSid = resolveParentSessionId(sessionId);
      broadcast("agent:ask-request", {
        requestId,
        sessionId: realSid,
        questions,
        allowCustom: params.allow_custom !== false,
      });
      const answer = await new Promise<string>((resolve) => {
        const onAbort = () => {
          if (!pendingAsks.has(requestId)) return;
          pendingAsks.delete(requestId);
          resolve("（提问已取消）");
          broadcast("agent:ask-closed", { requestId });
        };
        // 正常响应路径解除 abort 监听——长会话多次提问不累积监听器
        const wrappedResolve = (text: string) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(text);
        };
        pendingAsks.set(requestId, {
          sessionId: realSid,
          resolve: wrappedResolve,
          questions: questions.map((q) => ({ id: String(q.id), question: String(q.question) })),
        });
        // run 级 signal：用户打断 / killChat 时 abort → 取消挂起并通知前端关闭卡片
        signal?.addEventListener("abort", onAbort, { once: true });
      });
      return { content: [{ type: "text" as const, text: answer }] };
    },
  } as any) as ToolDefinition;
}

export class AgentService {
  constructor(private store: Store) {
  }
  private activeRuns: Map<string, ActiveRun> = new Map();
  private activeChats: Map<string, ActiveChat> = new Map();
  /** EM 侧正在进行的回合（promptAndBridge 进行中）——steer 区分真运行 vs isStreaming 残留 */
  private activePromptSessions: Set<string> = new Set();
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
    // 默认模型(无兜底降级;模型不可用时返回 null,由 SDK/上层按默认行为处理)
    return getActiveModel(store) ?? null;
  }

  private async buildExtraTools(projectPath: string, sessionId: string, chatId?: string, opts?: { worker?: boolean }): Promise<{
    tools: ToolDefinition[];
    canUseTool: CanUseToolFn;
    /** learn/search_experiences 是否已注册（会话级快照——触发提示按此判断，不按实时设置） */
    learnInstalled: boolean;
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
      const mcpTools = await loadMcpTools(projectPath);
      const agentTemplateTool = await createAgentTemplateTool();
      const stopAgentTool = await createStopAgentTool(sessionId);
      const listAgentsTool = await createListAgentsTool(sessionId);
      const readAgentLogTool = await createReadAgentLogTool(sessionId);
      const allTools = [taskTool, agentTemplateTool, stopAgentTool, listAgentsTool, readAgentLogTool, ...productTools, ...mcpTools];
      // 粘贴导入工具（用户明确意图驱动，恒装——见 import-tools.ts 头注释）
      allTools.push(...(await createImportTools()));
      // use_skill 非挂起类（读+统计），worker 也装——提示词多处「用 use_skill 加载」在 worker 同样成立；
      // 其 model 切换 hook 在 worker（无 chat）下降级为 false，无害
      allTools.push(await createSkillTool(projectPath, {
        onModelSwitch: (modelName) => this.switchModelForSkill(sessionId, modelName),
      }));
      // ask_user 仅主会话装——worker（runWorker，无前端卡片）调用挂起交互工具会永久挂起（无 UI 可响应）
      if (!opts?.worker) {
        allTools.push(await createAskUserTool(sessionId));
      }
      // manage_skill 受开关控制（D8：AI 写入能力默认关闭，设置→插件→Skills 一键开启；
      // 活跃会话工具集固定于创建时——开关对新建/重启恢复的会话生效）
      if (this.store.getSettings().manageSkillEnabled) {
        allTools.push(await createManageSkillTool(projectPath));
      }
      // learn + search_experiences 受独立开关控制（D8：自沉淀默认关闭；两工具同进退）。
      // worker 不装：learn 审阅卡片依赖前端，worker 无 UI，模型调用即永久挂起。
      // 注册结果作为快照返回（记入 chat）——活跃会话工具集固定于创建时，触发提示必须与快照一致，
      // 不能按实时设置判断（中途开开关会提示指向本会话不存在的工具——实测发生过）
      let learnInstalled = false;
      if (!opts?.worker && this.store.getSettings().learnEnabled) {
        allTools.push(
          await createLearnTool({
            projectPath,
            requestReview: (payload, signal) => this.requestLearnReview(sessionId, payload, signal),
          }),
          await createSearchExperiencesTool(projectPath),
        );
        learnInstalled = true;
      }

      return { tools: allTools, canUseTool, learnInstalled };
    } catch (e) {
      console.error("[agent] tool creation failed:", e);
      return { tools: [], canUseTool, learnInstalled: false };
    }
  }

  private buildSystemPrompt(projectPath: string, isDesigner?: boolean): string {
    const parts: string[] = [];

    // Mint-D 主会话 = 基础 Mint prompt(或用户自定义) + 设计能力增强段(附加不替换)
    const effective = resolveEffectivePrompt();
    if (effective) parts.push(effective);
    if (isDesigner) {
      const boost = MINT_DESIGN_BOOST;
      if (boost) parts.push(boost);
    }

    // skill 注入已收敛到 Pi 原生 <available_skills>（pi-session skillsOverride 并入四来源），
    // EM 自拼 skills 段（buildSkillsPrompt）退役——避免双重注入

    // 动态 section(借鉴 cc section 组装):项目环境 + 项目类型规范
    const env = buildProjectEnvSection(projectPath);
    if (env) parts.push(env);
    const profile = buildProjectProfileSection(readProjectProfile(projectPath));
    if (profile) parts.push(profile);

    // 历史经验注入（learn 开关开启时；与工具注册同开关）：项目级优先 + 使用次数排序，
    // top-N 紧凑块作背景——「经验库里有货」这件事让模型开箱即知，不用等它想起 search
    if (this.store.getSettings().learnEnabled) {
      const exp = buildExperienceInjection(projectPath);
      if (exp) parts.push(exp);
    }

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
    // 标记进行中回合（steer 用它区分「真在运行」vs「isStreaming 残留」——超时中断后
    // SDK isStreaming 可能残留 true，若无此标记 steer 会把消息入队永不消费）
    this.activePromptSessions.add(sessionId);

    // 回合内节流上报使用率:长工具回合(连续几十次工具调用)内上下文可能暴涨(工具结果大),
    // 只在回合结束上报会错过 EM 弹窗阈值 → SDK 兜底(98%)直接压缩,用户感知"跳过阈值"。
    // 5s 节流:回合内频繁流式事件不刷屏,回合结束的成功/错误路径仍各自强制上报
    let lastCtxReport = 0;
    const reportCtxThrottled = () => {
      const now = Date.now();
      if (now - lastCtxReport < 5000) return;
      lastCtxReport = now;
      const usage = session.getContextUsage();
      if (usage) {
        broadcast("agent:context-usage", {
          chatId, percentage: usage.percent ?? null,
          totalTokens: usage.tokens ?? 0, maxTokens: usage.contextWindow,
        });
      }
    };

    const unsub = session.subscribe((event: AgentSessionEvent) => {
      try {
        bridgeSessionEvents(event, {
          onEvent: (ev) => {
            ev.sessionId = sessionId;
            ev.chatId = chatId;
            broadcast("agent:stream", ev);
            this.bufferEvent(sessionId, ev);
            reportCtxThrottled();
          },
          getSession: () => session,
          setPendingResult: (ev: PiChatEvent) => { pendingResult = ev; },
        });

        // ── 压缩追踪 ──
        if (chat && event.type === "compaction_end") {
          if (!event.aborted && !event.willRetry) {
            chat.compactCount++;
            console.log(`[agent] compact #${chat.compactCount}: chatId=${chatId}`);
          }
          // 压缩后刷新使用率:压缩后无新回复时 getContextUsage 返回 percent null(旧 usage
          // 不可信)→ 上报 0,UI 不再残留压缩前的旧百分比(下条回复后更新为真实值)
          const usage = chat.session?.getContextUsage();
          if (usage) {
            broadcast("agent:context-usage", {
              chatId, percentage: usage.percent ?? null,
              totalTokens: usage.tokens ?? 0, maxTokens: usage.contextWindow,
            });
          }
        }

        // ── learn 硬信号采集（期3）：单轮口径——agent_start 归零。
        //    归零信号用 agent_start 而非 turn_start——源码实证（pi-agent-core/agent-loop.js
        //    runLoop 内层循环）：turn_start 在每个工具调用批次都发，用它归零计数永远到不了阈值 ──
        if (chat && event.type === "agent_start") {
          chat.toolCallCount = 0;
          chat.learnErrorSeen = false;
          chat.learnFixAfterError = false;
          chat.learnErrorText = "";
        }
        if (chat && event.type === "tool_execution_start") {
          chat.toolCallCount++;
          // 报错之后出现写类工具 = 修复动作（构成「错误-修复对」——最高价值的沉淀信号）
          if (chat.learnErrorSeen && isFixTool(String((event as { toolName?: string }).toolName ?? ""))) {
            chat.learnFixAfterError = true;
          }
        }
        // 工具报错（内容优先于退出码——见会话行为分析的口径，此处取 SDK 的 isError 标记）
        if (chat && event.type === "tool_execution_end" && (event as { isError?: boolean }).isError) {
          chat.learnErrorSeen = true;
          // 截取报错文本摘录（与模型上下文同源；压缩空白防超长），供踩坑信号触发经验回递
          const ev = event as { toolName?: string; result?: unknown };
          try {
            const raw = ev.result === undefined ? "" : typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result);
            chat.learnErrorText = ((ev.toolName ? ev.toolName + " " : "") + raw).replace(/\s+/g, " ").slice(0, 150);
          } catch {
            chat.learnErrorText = ev.toolName ?? "";
          }
        }
      } catch (e) {
        console.error("[agent] bridge error:", e);
      }
    });

    try {
      // 不做超时限制——SDK/API 端自处理（长思考任务可能合法超过 10 分钟，EM 层超时
      // 会误掐断；且曾因只 reject 不取消底层导致会话卡死）。中断由用户主动打断触发。
      const send = systemPayload
        ? session.sendCustomMessage(systemPayload, { triggerTurn: true })
        : session.prompt(text, images ? { images } : undefined);
      await send;

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
              percentage: usage.percent ?? null,
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

        // ── learn 分级触发（期3）：回合结束检查累计工具调用数。
        //    缓存中性：系统消息为会话尾部追加，前缀不变，缓存命中不受损 ──
        if (chat) this.maybeInjectLearnHint(chat);
      }
    } catch (err: unknown) {
      const msg = normalizeApiError(err);
      const raw = err instanceof Error ? err.message : String(err);
      console.error(`[agent] prompt error: chatId=${chatId}`, raw);
      // Pi 压缩进行中拒绝新 prompt(user 消息不落盘,前端无响应)→ 明确提示可重试
      const compactionBlocked = raw.toLowerCase().includes("compaction");
      broadcast("agent:stream", {
        type: "error", sessionId, chatId,
        message: compactionBlocked ? "正在整理上下文，请稍候再试" : msg,
        canRetry: compactionBlocked,
      });
      broadcast("agent:exit", { runId: chatId, code: -1 });
      // 错误/超时/中断回合也刷新使用率——否则 ctxPct 停留旧值,EM 弹窗可能漏触发
      // (error 回合无 usage → getContextUsage 估算,至少让前端看到当前口径)
      setTimeout(() => {
        const usage = session.getContextUsage();
        if (usage) {
          broadcast("agent:context-usage", {
            chatId,
            percentage: usage.percent ?? null,
            totalTokens: usage.tokens ?? 0,
            maxTokens: usage.contextWindow,
          });
        }
      }, 500);
    } finally {
      unsub();
      this.activePromptSessions.delete(sessionId);
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

        const { tools: extraTools, canUseTool } = await this.buildExtraTools(resolvedPath, runId, undefined, { worker: true });
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
    /** 前端发起发送的 tab id(透传回 chat-session 广播,前端精确绑定 tab,防多新 tab 错配) */
    tabId?: string,
  ): Promise<{ chatId: string }> {
    const resolvedPath = path.resolve(resolveHome(projectPath));
    // 无项目时 cwd 是 workspace 兜底目录——确保存在(不存在则 Pi 会话创建失败)
    if (!fs.existsSync(resolvedPath)) fs.mkdirSync(resolvedPath, { recursive: true });

    // 已有活跃会话 → 直接用
    if (resumeSessionId) {
      const existing = this.findActiveChat(resumeSessionId);
      if (existing && existing.session) {
        // 应用思考等级(prompt 前同步设置,与新建分支一致)——前端切等级不再立即 IPC,
        // 等级统一随发送应用,消除"切等级 IPC 与发送 IPC 并发"的 SDK 竞态窗口
        if (thinkingLevel) {
          try { existing.session.setThinkingLevel(thinkingLevel as any); }
          catch (e) { console.warn("[agent] setThinkingLevel 失败:", (e as Error).message); }
        }
        // 防卡死：isStreaming 残留但 EM 无进行中回合(超时中断等)→ 强制复位再正常发送，
        // 否则 SDK prompt() 抛 "Agent is already processing" → 消息发不出、不调 API
        if (existing.session.isStreaming && !this.activePromptSessions.has(resumeSessionId)) {
          console.warn(`[agent] sendMessage: session ${resumeSessionId} isStreaming 残留，强制复位`);
          try { existing.session.abort(); } catch { /* abort 无副作用 */ }
          await existing.session.waitForIdle().catch(() => {});
        }
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
    const { tools: extraTools, canUseTool, learnInstalled } = await this.buildExtraTools(
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
      toolCallCount: 0,
      learnErrorSeen: false,
      learnFixAfterError: false,
      learnErrorText: "",
      learnSuggestDone: false,
      learnToolInstalled: learnInstalled,
    };
    // learn 去重标记从磁盘恢复（重启后同一会话不重复提示/建议，防重复沉淀）
    const learnState = loadLearnStates()[chat.sessionId];
    if (learnState) {
      chat.learnSuggestDone = !!learnState.suggestDone;
    }

    if (isDesigner) {
      chat.agentType = "designer";
      if (resolvedPath) {
        const resourcesDir = getResourcesDir();
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
      broadcast("agent:chat-session", { chatId, sessionId: chat.sessionId, tabId });
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

  /** 按模型名（可选指定供应商）解析运行时 Model 对象；找不到返回 null（不触发运行时重建） */
  private async resolveModelByName(modelName: string, providerId?: string): Promise<Model<any> | null> {
    const { getModelRuntime } = await import("./pi-init");
    const runtime = await getModelRuntime(this.store);
    const providers = this.store.getSettings().apiProviders;
    // 会话级切换:指定供应商优先(设置中切供应商时联动传入);缺省用全局 current
    const activeId = providerId || providers?.current;
    const activeCfg = activeId ? providers?.configs?.[activeId] : undefined;
    if (!activeCfg || !activeId) return null;
    const provider = activeCfg.presetId === "custom" ? activeId : activeCfg.presetId;
    return (runtime.getModel(provider, modelName) as Model<any>) ?? null;
  }

  /** 会话热切模型并广播前端（手动切换与 skill model 字段共用收口——前端 chatModel 显示与 session-cache 持久化都依赖此广播） */
  private async applySessionModel(chat: ActiveChat, model: Model<any>, modelName: string): Promise<void> {
    await chat.session!.setModel(model as any);
    chat.currentModel = modelName;
    broadcast("agent:model-changed", { sessionId: chat.sessionId, model: modelName });
  }

  async setModel(sessionId: string, modelName: string, providerId?: string): Promise<void> {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return;
    // 按用户选的模型名直接找 Model 对象热切（不依赖"当前供应商默认模型"比较——
    // 原实现选非默认模型时 id 不匹配走 resetModelRuntime，实际没切到所选模型）
    const model = await this.resolveModelByName(modelName, providerId);
    if (model) {
      await this.applySessionModel(chat, model, modelName);
    } else {
      // 模型不在运行时（新供应商 apiKey 未注册）→ 重建运行时（重建时全量 sync 配置）
      resetModelRuntime();
    }
  }

  /** skill frontmatter `model` 字段触发的会话级切换；模型不存在降级忽略（不重建运行时，返回 false 由调用方说明） */
  private async switchModelForSkill(sessionId: string, modelName: string): Promise<boolean> {
    const chat = this.findActiveChat(sessionId);
    if (!chat?.session) return false;
    const model = await this.resolveModelByName(modelName);
    if (!model) return false;
    await this.applySessionModel(chat, model, modelName);
    return true;
  }

  /** learn 审阅挂起：广播 learn-request → 等用户确认（respondLearn / abort / 会话关闭 resolve） */
  private async requestLearnReview(
    sessionId: string,
    payload: { memory: string; context?: string; skill?: { action: "create" | "update"; name: string; description: string; body: string } },
    signal: AbortSignal | undefined,
  ): Promise<LearnResponse> {
    const requestId = randomUUID();
    // 工具闭包绑定的可能是 EM 临时 ID——广播前解析真实 ID（同 ask_user 机制）
    const realSid = resolveParentSessionId(sessionId);
    broadcast("agent:learn-request", { requestId, sessionId: realSid, ...payload });
    return new Promise<LearnResponse>((resolve) => {
      const onAbort = () => {
        if (!pendingLearns.has(requestId)) return;
        pendingLearns.delete(requestId);
        resolve({ approved: false });
        broadcast("agent:learn-closed", { requestId });
      };
      // 正常响应路径解除 abort 监听——长会话多次 learn 不累积监听器
      const wrappedResolve = (r: LearnResponse) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(r);
      };
      pendingLearns.set(requestId, { sessionId: realSid, resolve: wrappedResolve });
      // run 级 signal：用户打断 / killChat → 取消挂起并通知前端关闭卡片
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** learn 触发：单轮硬信号达到「评估门槛」时提示一次。门槛只是下限——够格被评估，
   *  不等于值得沉淀；值不值得由模型按提示中的判定标准判断（无价值静默跳过）。
   *  双通道（WB 标准工程化）：踩坑修复（报错→修复）价值最高，门槛 8；纯大轮门槛 15。
   *  每会话最多一次（learn-state.json 持久化，重启不重放）。 */
  private maybeInjectLearnHint(chat: ActiveChat): void {
    // 工具存在性按会话创建时快照（learnToolInstalled）判断——活跃会话工具集固定于创建时，
    // 按实时设置判断会提示指向本会话不存在的工具（实测发生过：中途开开关 → learn not found）
    if (!chat.learnToolInstalled || chat.learnSuggestDone) return;
    const gate = evaluateLearnGate({
      toolCallCount: chat.toolCallCount,
      errorSeen: chat.learnErrorSeen,
      fixAfterError: chat.learnFixAfterError,
    });
    if (!gate) return;
    chat.learnSuggestDone = true;
    saveLearnState(chat.sessionId, { suggestDone: true });
    const headline = gate.channel === "fix"
      ? `本轮出现「工具报错 → 修复」的过程（${chat.toolCallCount} 次工具调用），踩坑类经验复用价值最高，优先评估`
      : `本轮工具调用 ${chat.toolCallCount} 次（达到沉淀评估门槛）`;
    // 经验回递：用本会话报错文本检索历史经验，命中则注入（在弹沉淀卡片之前先让模型知道
    // 「上次遇过」——复用价值在存之前就已经兑现；检索失败/无报错文本则正常走评估提示）
    let recallBlock = "";
    const errQ = (chat.learnErrorText ?? "").trim();
    if (errQ) {
      try {
        const { hits } = searchExperiences(errQ, chat.projectPath);
        if (hits.length > 0) {
          recallBlock = `\n\n【相关历史经验（已按本会话报错检索到，仅作参考；判断适用再复用，不刻意使用）】\n`
            + hits.slice(0, 3).map((e) => `- ${e.memory.replace(/\s+/g, " ").slice(0, 240)}`).join("\n");
        }
      } catch (e) {
        console.warn("[learn] 经验回递检索失败（不影响评估提示）:", (e as Error).message);
      }
    }
    // triggerTurn: true 开捕获回合——本轮上下文还热，是评估最佳时机
    this.injectSystemMessage(
      chat.sessionId,
      `${headline}${recallBlock}。先判断本轮是否存在「值得沉淀」的内容，再决定是否调用 learn：

【值得沉淀】踩坑修复（报错→根因→解法，下次能避坑）／验证过的方法流程（换个项目也能用）／项目约定与架构决策（删掉这条未来的你会犯错）。

【不值得沉淀——直接跳过】一次性操作（配环境、跑一次命令、本次专属排查）／纯信息问答（读代码讲原理，没有方法论）／已沉淀过（用 search_experiences 确认过）／项目特有细节换项目无用／含敏感信息（密钥、内网地址）。

判定为不值得沉淀时：**静默跳过**——不调 learn、不弹卡片、也不要在回复里提及沉淀，继续正常汇报即可。值得沉淀时才调 learn（会弹审阅卡片，用户确认后落盘）。`,
      "learn",
      { triggerTurn: true },
    );
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

  killChat(chatId: string): void {
    const chat = this.activeChats.get(chatId);
    if (chat) {
      chat.abortController.abort();
      chat.session?.abort().catch(() => {});
      chat.session?.dispose();
      permissionService.clearSessionWhitelist(chat.sessionId);
      permissionService.clearSessionPending(chat.sessionId);
      clearPendingAsks(chat.sessionId);
      clearPendingLearns(chat.sessionId);
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
      // 费用:jsonl 每条 assistant 消息的 usage.cost 是 SDK 按模型定价算好的美元值,直接累加(与活跃分支 stats.cost 单位一致)
      let costUsd = 0;

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
            const c = (usage as { cost?: { total?: number } }).cost;
            if (c?.total) costUsd += c.total;
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
        cost: costUsd,
      };
    } catch (e) {
      console.error("[agent] getSessionStats disk read failed:", e);
      return null;
    }
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
    if (!chat?.session) return;
    // 会话实际空闲时 steer 只入队不落盘(Pi agent core 的 steering 队列仅在回合循环内消费,
    // 空闲入队永不投递→"消息发出去了但 SDK 没落盘没响应")→ 改走正常发送路径
    if (!chat.session.isStreaming) {
      this.promptAndBridge(chat.session, chat.sessionId, chat.chatId, text, chat);
      return;
    }
    // isStreaming=true 但 EM 无进行中回合 → SDK 残留（如超时中断后 isStreaming 未复位，
    // 实际回合已死）→ 强制 abort 复位，再走正常发送，避免消息入队永不消费
    if (!this.activePromptSessions.has(sessionId)) {
      console.warn(`[agent] steer: session ${sessionId} isStreaming 残留(无进行中回合)，强制复位`);
      try { chat.session.abort(); } catch { /* abort 无副作用 */ }
      await chat.session.waitForIdle().catch(() => {});
      this.promptAndBridge(chat.session, chat.sessionId, chat.chatId, text, chat);
      return;
    }
    await chat.session.steer(text);
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
            // 不开回合的通知注入（triggerTurn:false）：过滤回合边界事件——
            // SDK 对 custom 消息也 emit turn_start，前端收到会 setBusy 且无 turn_end 清除
            // （custom 注入无真实回合），导致状态栏残留「正在请求」。通知只需 custom_event 气泡
            if (!opts?.triggerTurn && (ev.type === "turn_start" || ev.type === "turn_end")) return;
            ev.sessionId = sessionId;
            ev.chatId = chat.chatId;
            broadcast("agent:stream", ev);
            this.bufferEvent(sessionId, ev);
          },
          getSession: () => chat.session,
          // triggerTurn: true 的汇总回合结束(agent_end → turn_end)时广播 agent:exit——
          // 否则前端 busy 残留(打断按钮卡住),且后续消息误走 steer 路径发送失败
          setPendingResult: (ev) => {
            if (ev.type === "turn_end" && opts?.triggerTurn) {
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
    if (!chat?.session) return;
    broadcast("agent:context-summarizing", { chatId: chat.chatId, type: "compact" });
    // 手动压缩桥接：compact() 直接调 SDK（不经 promptAndBridge 的 subscribe），
    // compaction_start/end 事件无人转发 → 前端收不到 compacted、压缩后使用率不刷新
    // （ctxPct 残留旧值）。这里临时订阅，把压缩生命周期事件桥到前端并刷新 usage。
    const unsub = chat.session.subscribe((event: AgentSessionEvent) => {
      try {
        if (event.type === "compaction_start") {
          broadcast("agent:stream", { type: "compacting", sessionId, chatId: chat.chatId });
        } else if (event.type === "compaction_end") {
          broadcast("agent:stream", { type: "compacted", sessionId, chatId: chat.chatId });
          // 压缩后刷新使用率:压缩后无新回复时 getContextUsage 返回 percent null(旧 usage
          // 不可信)→ 上报 0,UI 不再残留压缩前的旧百分比(下条回复后更新为真实值)
          const usage = chat.session?.getContextUsage();
          if (usage) {
            broadcast("agent:context-usage", {
              chatId: chat.chatId, percentage: usage.percent ?? null,
              totalTokens: usage.tokens ?? 0, maxTokens: usage.contextWindow,
            });
          }
        }
      } catch (e) {
        console.error("[agent] compact bridge error:", e);
      }
    });
    try {
      await chat.session.compact(instructions);
      // 成功路径:SDK 内部发 compaction_end → compacted 广播清除蒙版
    } catch (e) {
      console.error(`[agent] compact failed: chatId=${chat.chatId}`, e);
      // 压缩失败:compaction_end 不会到达(或带 error),蒙版会卡死——发错误提示
      broadcast("agent:stream", {
        type: "error", sessionId, chatId: chat.chatId,
        message: "上下文压缩失败，请稍后重试", canRetry: true,
      });
    } finally {
      unsub();
      // 无论成败都清除蒙版(compaction_end 的 compacted 可能因 aborted/无 result 不广播)
      broadcast("agent:context-summarizing", { chatId: chat.chatId, type: "done" });
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
      // 广播统一为 EM 注册名（activeCfg.models 列表值）——前端显示、session-cache 持久化、
      // 重启恢复 setModel 都按注册名解析；SDK id 与注册名通常一致，防御性映射防格式漂移
      broadcast("agent:model-changed", { sessionId, model: this.toEmModelName(result.model.id) });
    }
  }

  /** SDK 模型 id → EM 注册名（activeCfg.models 反向匹配；无匹配原样返回） */
  private toEmModelName(sdkId: string): string {
    const providers = this.store.getSettings().apiProviders;
    const activeCfg = providers?.current ? providers.configs?.[providers.current] : undefined;
    const models = activeCfg?.models ?? [];
    if (models.includes(sdkId)) return sdkId;
    return models.find((m) => sdkId.endsWith(m) || sdkId.includes(m)) ?? sdkId;
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
      clearPendingAsks(chat.sessionId);
      clearPendingLearns(chat.sessionId);
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

