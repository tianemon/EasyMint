/**
 * 群聊会话容器(需求 4:多 Agent 同一会话,应用层消息转发,方案 B)
 *
 * @deprecated 2026-08-05 方案收敛:主会话(Mint)+ task 工具动态委派 + Agent 模板模块
 * 已替代群聊的大部分场景。本容器保留为实验性功能,不继续投入开发。
 * 核心功能由 task 委派(executor)接管;业务路由/指派降级为 task 工具的 agent 参数。
 *
 * 保留原因:群聊 tab 可查看历史;记录文件(UI 显示)可复用为委派历史。
 *
 * 每个群聊 = 多个 Pi session 的虚拟聚合:
 * - 每个参与 Agent 一个独立 Pi session(独立 jsonl / 独立上下文)
 * - 用户消息 @提及路由到目标 Agent(默认主 Agent=第一个)
 * - Agent 回合结束 → 提取结论文本 → 转发给其他 Agent(默认 conclusion 策略)
 * - 防环:最大转发深度(maxForwardDepth)+ 结论才转发(不转工具过程/thinking)
 * - 失败处理:回合异常 → 重试 ≤3 → 标记 offline 跳过(不阻塞其他 Agent)
 * - 持久化:项目级 .easymint/group-sessions.json(结构元数据,恢复用)
 *
 * 事件广播:所有 Agent 的流事件注入 agentRole(前端群聊视图标注来源)。
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { resolveHome } from "../utils/paths";
import type { AgentSession, ToolDefinition } from "./pi-sdk";
import { createPiSession } from "./pi-session";
import { getDefineToolFn } from "./pi-sdk";
import { getTemplate } from "./agent-templates";
import { bridgeSessionEvents } from "./event-bridge";
import type { Model } from "@earendil-works/pi-ai";
import type { Store } from "./store";
import type { SystemMessageKind } from "../../shared/prompts";
import { normalizeApiError } from "../../shared/api-errors";
import type { CanUseToolOptions, PermissionResult } from "./permission/agent-permission-service";

// ── 持久化类型(写盘) ────────────────────────────────

export interface GroupAgentMeta {
  role: string;
  templateId: string;
  provider?: string;
  model?: string;
  /** Pi 真实 sessionId(各 Agent 独立 jsonl) */
  sessionId: string;
}

export interface GroupSessionMeta {
  groupId: string;
  projectId: string;
  presetId?: string;
  createdAt: number;
  agents: GroupAgentMeta[];
}

/** 群聊记录文件消息(UI 显示专用,不进任何 agent 上下文) */
export interface GroupRecordMessage {
  agentRole: string;
  text: string;
  piTs: number;
  forwardedFrom?: string;
}

/** 群聊记录文件结构(8.8:纯结论+角色+piTs,UI 显示专用) */
export interface GroupRecord {
  groupId: string;
  messages: GroupRecordMessage[];
}

// ── 运行时类型 ──────────────────────────────────────

interface ActiveGroupAgent {
  meta: GroupAgentMeta;
  session: AgentSession;
  busy: boolean;
  status: "idle" | "busy" | "offline";
  offlineReason?: string;
  /** 连续失败次数(达到阈值 → offline) */
  retries: number;
  /** 背景注入暂存队列:目标流式中(回合进行中)时,Pi 的 sendCustomMessage 会 steer 触发回话,
      违反"背景不回话"设计。故忙时入队,回合结束(turn_end)后再 triggerTurn:false 纯注入 */
  pendingBackground: Array<{ content: string; details: Record<string, unknown> }>;
}

interface ActiveGroup {
  meta: GroupSessionMeta;
  /** 群聊统一 chatId——所有 Agent 事件注入它,前端群聊视图按此关联 */
  chatId: string;
  agents: ActiveGroupAgent[];
}

export interface GroupServiceDeps {
  store: Store;
  getAgentDir: () => string;
  /** 按模板 tools 声明构建群聊 Agent 工具集(基础 coding 工具由 createPiSession 强制追加) */
  buildGroupTools: (projectPath: string, sessionId: string, chatId: string | undefined, templateTools: string[]) => Promise<{
    tools: ToolDefinition[];
    canUseTool: (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;
  }>;
  buildSystemPrompt: (projectPath: string, templatePrompt: string, role?: string, members?: string) => string;
  resolveModel: (provider?: string, model?: string) => Promise<Model<any> | null>;
  broadcast: (channel: string, data: unknown) => void;
  injectSystemMessage: (sessionId: string, text: string, kind: SystemMessageKind, opts?: { triggerTurn?: boolean }) => void;
}

const MAX_RETRIES = 3;

// ── GroupSessionManager ─────────────────────────────

export class GroupSessionManager {
  private groups = new Map<string, ActiveGroup>();
  private counter = 0;

  constructor(private deps: GroupServiceDeps) {}

  // ── 持久化 ────────────────────────────────────────

  private storePath(projectPath: string): string {
    return path.join(resolveHome(projectPath), ".easymint", "group-sessions.json");
  }

  /** 群聊记录文件路径(8.8:UI 显示专用) */
  private recordPath(projectPath: string, groupId: string): string {
    return path.join(resolveHome(projectPath), ".easymint", "group-sessions", `${groupId}.json`);
  }

  private readRecord(projectPath: string, groupId: string): GroupRecord {
    const p = this.recordPath(projectPath, groupId);
    if (!existsSync(p)) return { groupId, messages: [] };
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as GroupRecord;
    } catch (e) {
      console.error("[group] 解析群聊记录失败:", (e as Error).message);
      return { groupId, messages: [] };
    }
  }

  /** 追加一条群聊记录(UI 显示,不进上下文)。写入失败不影响主流程。 */
  private appendRecord(projectPath: string, groupId: string, msg: GroupRecordMessage): void {
    try {
      const p = this.recordPath(projectPath, groupId);
      mkdirSync(path.dirname(p), { recursive: true });
      const rec = this.readRecord(projectPath, groupId);
      rec.messages.push(msg);
      writeFileSync(p, JSON.stringify(rec, null, 2));
    } catch (e) {
      console.error("[group] 追加群聊记录失败:", (e as Error).message);
    }
  }

  /** 读取群聊记录(前端历史加载用) */
  getRecord(projectPath: string, groupId: string): GroupRecord {
    return this.readRecord(projectPath, groupId);
  }

  private readGroups(projectPath: string): GroupSessionMeta[] {
    const p = this.storePath(projectPath);
    if (!existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, "utf-8")) as GroupSessionMeta[];
    } catch (e) {
      console.error("[group] 解析 group-sessions.json 失败:", (e as Error).message);
      return [];
    }
  }

  private persist(g: ActiveGroup): void {
    const p = this.storePath(g.meta.projectId);
    try {
      mkdirSync(path.dirname(p), { recursive: true });
      const list = this.readGroups(g.meta.projectId);
      const idx = list.findIndex((m) => m.groupId === g.meta.groupId);
      if (idx === -1) list.push(g.meta);
      else list[idx] = g.meta;
      writeFileSync(p, JSON.stringify(list, null, 2));
    } catch (e) {
      console.error("[group] 持久化失败:", (e as Error).message);
    }
  }

  listGroups(projectPath: string): GroupSessionMeta[] {
    return this.readGroups(projectPath);
  }

  getActive(groupId: string): ActiveGroup | undefined {
    return this.groups.get(groupId);
  }

  // ── 创建群聊 ──────────────────────────────────────

  /** 创建群聊:每个模板建一个独立 Pi session,首条消息发给主 Agent */
  async createGroup(
    projectPath: string,
    templateIds: string[],
    opts?: { presetId?: string; message?: string; permissionMode?: string; thinkingLevel?: string },
  ): Promise<{ groupId: string; chatId: string }> {
    const resolvedPath = path.resolve(resolveHome(projectPath));
    const settings = this.deps.store.getSettings();
    const maxAgents = settings.maxGroupAgents ?? 3;

    if (templateIds.length === 0) throw new Error("群聊至少需要一个参与角色");
    if (templateIds.length > maxAgents) {
      throw new Error(`群聊最多 ${maxAgents} 个 Agent,请减少参与角色(设置→群聊可调)`);
    }

    const groupId = `group-${randomUUID().slice(0, 8)}`;
    const chatId = `group-chat-${++this.counter}`;

    // 先收集所有角色名(供 system prompt 的 {members} 占位符)
    const allRoles: string[] = [];
    for (let i = 0; i < templateIds.length; i++) {
      const template = getTemplate(templateIds[i]!);
      allRoles.push(`${template?.name ?? `Agent${i + 1}`}`);
    }
    const membersStr = allRoles.join(" / ");

    const agents: ActiveGroupAgent[] = [];
    for (let i = 0; i < templateIds.length; i++) {
      const template = getTemplate(templateIds[i]!);
      const role = template?.name ?? `Agent${i + 1}`;

      const model = await this.deps.resolveModel(template?.provider, template?.model);
      if (!model) {
        throw new Error(`角色 ${role} 无可用模型(供应商未配置),请检查设置`);
      }

      // 临时 sessionId 绑定工具(与主会话相同模式);真实 sessionId 由 Pi 生成
      const tempSessionId = randomUUID();
      const agentChatId = `${groupId}-a${i}`;
      // 工具集由模板 tools 声明驱动(需求 4:AgentTemplate.tools 定义角色能力边界)
      const { tools: extraTools, canUseTool } = await this.deps.buildGroupTools(
        resolvedPath, tempSessionId, agentChatId, template?.tools ?? [],
      );
      // 阶段C:assign_to_agent 工具注入所有群聊 Agent(显式激活通道)
      const assignTool = await this.createAssignTool(groupId);
      extraTools.push(assignTool);
      // 群聊 system prompt:模板 prompt + 协作规则 + 成员列表 + 角色标注
      const systemPrompt = this.deps.buildSystemPrompt(resolvedPath, template?.prompt ?? "", role, membersStr);

      const session = await createPiSession({
        cwd: resolvedPath,
        agentDir: this.deps.getAgentDir(),
        model,
        thinkingLevel: (opts?.thinkingLevel as any) ?? "medium",
        store: this.deps.store,
        systemPrompt,
        extraTools,
        canUseTool,
      });

      // 权限模式写入 session-cache(createCanUseTool 实时读取,auto/plan/acceptEdits)
      if (opts?.permissionMode) {
        const { writeCache } = await import("./session-cache");
        writeCache(session.sessionId, { permissionMode: opts.permissionMode });
      }

      agents.push({
        meta: {
          role,
          templateId: templateIds[i]!,
          provider: template?.provider,
          model: template?.model,
          sessionId: session.sessionId,
        },
        session,
        busy: false,
        status: "idle",
        retries: 0,
        pendingBackground: [],
      });
      console.log(`[group] ${groupId} agent#${i} ready: role=${role} sessionId=${session.sessionId}`);
    }

    const group: ActiveGroup = {
      meta: {
        groupId,
        projectId: resolvedPath,
        presetId: opts?.presetId,
        createdAt: Date.now(),
        agents: agents.map((a) => a.meta),
      },
      chatId,
      agents,
    };
    this.groups.set(groupId, group);
    this.persist(group);

    // 8.0a:创建完成后注入初始化消息(triggerTurn:false,只进上下文不回话,UI 不显示)
    const initMsg = `[群聊已创建] 参与成员: ${membersStr}。群聊规则: 被 @ 或收到"群聊激活"系统消息时才回话;不要重复回应历史消息(之前的回复已处理);需要指派他人时调用 assign_to_agent({target:"角色名"});回话时优先响应当前最新指令;你的回复结论会自动同步给所有成员。`;
    for (const a of agents) {
      a.session.sendCustomMessage({
        customType: "forward_message",
        content: initMsg,
        display: false,
        details: { kind: "group_init" },
      }, { triggerTurn: false }).catch((e) => {
        console.error(`[group] ${a.meta.role} 初始化消息注入失败:`, (e as Error).message);
      });
    }

    if (opts?.message) {
      await this.sendGroupMessage(groupId, opts.message);
    }
    return { groupId, chatId };
  }

  // ── 消息路由 ──────────────────────────────────────

  /** 发送用户消息(阶段B:全量背景注入 + @ 显式激活) */
  async sendGroupMessage(groupId: string, text: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error("群聊不存在或已关闭");

    // 用户消息写入群聊记录(UI 显示;前端也本地 append,重启后靠记录文件恢复)
    this.appendRecord(group.meta.projectId, groupId, {
      agentRole: "user", text, piTs: Date.now(),
    });

    // 阶段B:用户消息注入所有 Agent(triggerTurn:false,只进上下文不回话)→ "共享上下文"感受
    // 只注入 user 文本,不含附件/代码
    this.broadcastBackground(group, { agentRole: "user", text, piTs: Date.now() });

    // @ 定位目标 → 激活回合(用户消息由前端本地 append,这里不广播 user_message 防重复)
    const targetIdx = this.resolveMention(group, text);
    await this.activateAgent(group, targetIdx, "user");
  }

  /** 背景注入:把一条群聊消息注入所有 Agent(不回话,只同步上下文)。
      目标忙(流式中)时 Pi 的 sendCustomMessage 会默认 steer 触发回话,违反设计——
      故忙时入队,回合结束(turn_end)后由 flushPendingBackground 纯注入 */
  private broadcastBackground(group: ActiveGroup, msg: { agentRole: string; text: string; piTs: number; forwardedFrom?: string }): void {
    const content = msg.agentRole === "user" ? msg.text : `[群聊背景] ${msg.agentRole} 的结论: ${msg.text}`;
    const details = { kind: "forward_message", from: msg.agentRole, forwardedFrom: msg.forwardedFrom };
    for (const a of group.agents) {
      this.injectBackground(a, content, details);
    }
  }

  /** 注入一条背景消息:目标忙 → 入队;空闲 → triggerTurn:false 纯注入 */
  private injectBackground(agent: ActiveGroupAgent, content: string, details: Record<string, unknown>): void {
    if (agent.busy || agent.status === "busy") {
      agent.pendingBackground.push({ content, details });
      return;
    }
    try {
      agent.session.sendCustomMessage({
        customType: "forward_message",
        content,
        display: false,
        details,
      }, { triggerTurn: false }).catch((e) => {
        console.error(`[group] ${agent.meta.role} 背景注入失败:`, (e as Error).message);
      });
    } catch (e) {
      console.error(`[group] ${agent.meta.role} 背景注入异常:`, (e as Error).message);
    }
  }

  /** 回合结束后 flush 暂存队列:把忙时积压的背景消息纯注入(triggerTurn:false) */
  private flushPendingBackground(agent: ActiveGroupAgent): void {
    if (agent.pendingBackground.length === 0) return;
    const queued = agent.pendingBackground;
    agent.pendingBackground = [];
    for (const bg of queued) {
      this.injectBackground(agent, bg.content, bg.details);
    }
  }

  /** 显式激活一个 Agent 开回合(不带内容,内容已由背景注入同步) */
  private async activateAgent(group: ActiveGroup, idx: number, fromRole: string): Promise<void> {
    const agent = group.agents[idx];
    if (!agent || agent.status === "offline") return;
    if (agent.busy) {
      console.log(`[group] ${agent.meta.role} busy, 激活跳过`);
      return;
    }
    // 走 promptAgent:回合订阅/重试/离线逻辑复用;text 为激活提示,模型读上下文回复。
    // 提示用强指令语气:必须现在回话(防止模型把激活当背景消息忽略)
    await this.promptAgent(group, idx, `[群聊激活] ${fromRole} 要求你现在回话。请基于群聊上下文,用一句与之前不同的、有价值的话回应。`, { depth: 0, forwarded: true, fromRole });
  }

  private resolveMention(group: ActiveGroup, text: string): number {
    const m = text.match(/@([^\s:：，。,]+)/);
    if (!m) return 0;
    const idx = group.agents.findIndex((a) => a.meta.role === m[1]);
    return idx === -1 ? 0 : idx;
  }

  /** 关闭群聊(释放会话) */
  closeGroup(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) return;
    for (const a of group.agents) {
      try {
        a.session.dispose();
      } catch { /* ignore */ }
    }
    this.groups.delete(groupId);
  }

  /** 创建 assign_to_agent 工具(阶段C):Agent 调它激活指定目标,不携带任务(内容已背景注入) */
  private async createAssignTool(groupId: string): Promise<ToolDefinition> {
    const defineTool = await getDefineToolFn();
    const manager = this; // eslint-disable-line @typescript-eslint/no-this-alias
    return defineTool({
      name: "assign_to_agent",
      label: "指派给其他 Agent",
      description: "将当前任务指派给群聊中的另一个 Agent。调用后该 Agent 会被激活回话——它的上下文里已有全部群聊信息,无需在参数中重复任务内容。目标名必须是群聊成员之一。",
      parameters: {
        type: "object" as const,
        properties: {
          target: { type: "string" as const, description: "目标 Agent 角色名,如 Builder / Evaluator" },
        },
        required: ["target"],
      },
      async execute(_tid: any, params: any): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
        const group = manager.groups.get(groupId);
        if (!group) return { content: [{ type: "text" as const, text: "群聊不存在或已关闭" }], details: {} };
        const targetRole = String(params?.target ?? "");
        const idx = group.agents.findIndex((a) => a.meta.role === targetRole);
        if (idx === -1) {
          const roles = group.agents.map((a) => a.meta.role).join(" / ");
          return { content: [{ type: "text" as const, text: `目标 ${targetRole} 不存在,可用成员: ${roles}` }], details: {} };
        }
        // 异步激活,不阻塞当前回合收尾。来源用"成员"(工具执行无法定位调用者角色,
        // 但调用者上下文里已有"已指派给 X"的 toolResult,目标通过群聊背景知道是谁)
        void manager.activateAgent(group, idx, "群聊成员");
        return { content: [{ type: "text" as const, text: `已指派给 ${targetRole}` }], details: {} };
      },
    }) as any;
  }

  // ── 回合驱动 + 转发 ───────────────────────────────

  private async promptAgent(
    group: ActiveGroup,
    idx: number,
    text: string,
    opts: { depth: number; forwarded: boolean; fromRole?: string },
  ): Promise<void> {
    const agent = group.agents[idx];
    if (!agent || agent.status === "offline") return;
    if (agent.busy) {
      console.log(`[group] ${agent.meta.role} busy, skip: ${text.slice(0, 40)}`);
      return;
    }
    agent.busy = true;
    agent.status = "busy";

    // 失败处理:重试 ≤MAX_RETRIES 次,重试前尝试切兜底模型(需求 1 联动);
    // 全部失败 → 标记 offline 跳过(不阻塞其他 Agent)
    let done = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.runTurn(group, idx, text, opts);
        agent.retries = 0; // 成功 → 重置连续失败计数
        done = true;
        break;
      } catch (err) {
        agent.retries = attempt;
        console.error(`[group] ${agent.meta.role} prompt error (attempt ${attempt}/${MAX_RETRIES}):`, err instanceof Error ? err.message : String(err));
        this.deps.broadcast("agent:stream", {
          type: "error", sessionId: agent.meta.sessionId, chatId: group.chatId,
          agentRole: agent.meta.role, message: normalizeApiError(err),
        });
        if (attempt < MAX_RETRIES) {
          const switched = await this.trySwitchFallback(agent);
          if (switched) console.log(`[group] ${agent.meta.role} 已切兜底模型,重试`);
        }
      }
    }

    if (!done) {
      agent.status = "offline";
      agent.offlineReason = `连续 ${MAX_RETRIES} 次失败`;
      this.deps.broadcast("agent:stream", {
        type: "status", sessionId: agent.meta.sessionId, chatId: group.chatId,
        agentRole: agent.meta.role, message: `${agent.meta.role} 已离线(连续失败),其他 Agent 不受影响`,
      });
    }
    agent.busy = false;
    if (agent.status === "busy") agent.status = "idle";
    // 回合彻底结束后 flush 忙时积压的背景队列(纯注入,不触发回话)
    this.flushPendingBackground(agent);
  }

  /** 单次回合:挂 subscribe 广播事件 + prompt/steer/followUp;回合结束触发转发 */
  private runTurn(
    group: ActiveGroup,
    idx: number,
    text: string,
    opts: { depth: number; forwarded: boolean; fromRole?: string },
  ): Promise<void> {
    const agent = group.agents[idx];
    const session = agent.session;
    return new Promise((resolve, reject) => {
      const unsub = session.subscribe((event) => {
        try {
          bridgeSessionEvents(event, {
            onEvent: (ev) => {
              // 注入群聊标识:统一 chatId + groupId(前端过滤)+ agentRole(标注来源)
              ev.sessionId = agent.meta.sessionId;
              ev.chatId = group.chatId;
              (ev as any).groupId = group.meta.groupId;
              (ev as any).agentRole = agent.meta.role;
              (ev as any).forwarded = opts.forwarded;
              (ev as any).forwardedFrom = opts.fromRole;
              // 激活回合:前端渲染 [X → Y] 激活标记(不占正常回复流)
              (ev as any).activation = opts.forwarded;
              this.deps.broadcast("agent:stream", ev);
            },
            getSession: () => session,
            setPendingResult: (ev) => {
              if (ev.type === "turn_end") {
                // 广播 turn_end(带群聊标识)——前端据此清 busy(群聊不广播 agent:exit)
                ev.sessionId = agent.meta.sessionId;
                ev.chatId = group.chatId;
                (ev as any).groupId = group.meta.groupId;
                (ev as any).agentRole = agent.meta.role;
                (ev as any).forwarded = opts.forwarded;
                (ev as any).forwardedFrom = opts.fromRole;
                this.deps.broadcast("agent:stream", ev);
                // 回合结束 → 提取累计全文结论 → 写入群聊记录(UI 显示)
                const conclusion = (session as any).getLastAssistantText?.() ?? "";
                const c = String(conclusion || "");
                if (c.trim()) {
                  this.appendRecord(group.meta.projectId, group.meta.groupId, {
                    agentRole: agent.meta.role,
                    text: c,
                    piTs: Date.now(),
                    forwardedFrom: opts.fromRole,
                  });
                  // 阶段B:结论背景注入除自己外所有 Agent(不回话;忙时入队等回合结束)
                  // 不含代码/toolResult/thinking——只转纯结论
                  for (const other of group.agents) {
                    if (other === agent) continue;
                    this.injectBackground(other, `[群聊背景] ${agent.meta.role} 的结论: ${c}`, {
                      kind: "forward_message", from: agent.meta.role, forwardedFrom: opts.fromRole,
                    });
                  }

                  // 阶段C兜底语法:结论含【转交@X】且未调 assign_to_agent 工具时,解析激活目标
                  // (主通道是工具调用;语法兜底防"模型漏调工具直接写转交")
                  const assignMatch = c.match(/【转交\s*@([^\s】]+)】/);
                  if (assignMatch?.[1]) {
                    const tIdx = group.agents.findIndex((a) => a.meta.role === assignMatch[1]);
                    if (tIdx !== -1 && tIdx !== group.agents.indexOf(agent)) {
                      console.log(`[group] 兜底语法转交: ${agent.meta.role} → ${assignMatch[1]}`);
                      void this.activateAgent(group, tIdx, agent.meta.role);
                    }
                  }
                }
              }
            },
          });
        } catch (e) {
          console.error("[group] bridge error:", e);
        }
      });

      // 阶段B:激活/用户消息都用 prompt 开回合。内容(用户消息/背景)已由 triggerTurn:false 注入,
      // 这里 prompt 的 text 只是"激活提示"——模型读上下文里的完整消息后回复
      const send = session.prompt(text);
      send.then(() => { unsub(); resolve(); }, (err) => { unsub(); reject(err); });
    });
  }

  /** 失败重试前尝试切兜底模型(当前激活供应商配置的 fallbackModel) */
  private async trySwitchFallback(agent: ActiveGroupAgent): Promise<boolean> {
    const settings = this.deps.store.getSettings();
    const activeCfg = settings.apiProviders?.current
      ? settings.apiProviders.configs?.[settings.apiProviders.current]
      : undefined;
    if (!activeCfg?.presetId || !activeCfg.fallbackModel) return false;
    const { getModelRuntime } = await import("./pi-init");
    const runtime = await getModelRuntime(this.deps.store);
    const fb = runtime.getModel(activeCfg.presetId, activeCfg.fallbackModel.replace(/\[1M\]$/, ""));
    if (!fb) return false;
    try {
      await agent.session.setModel(fb);
      return true;
    } catch {
      return false;
    }
  }
}
