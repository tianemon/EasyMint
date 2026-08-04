/**
 * 群聊会话容器(需求 4:多 Agent 同一会话,应用层消息转发,方案 B)
 *
 * 每个群聊 = 多个 Pi session 的虚拟聚合:
 * - 每个参与 Agent 一个独立 Pi session(独立 jsonl / 独立上下文)
 * - 用户消息 @提及路由到目标 Agent(默认主 Agent=第一个)
 * - Agent 回合结束 → 提取结论文本 → 转发给其他空闲 Agent(默认 conclusion 策略)
 * - 防环三层:① 消息 ID 去重(forwardSeen) ② 最大转发深度(maxForwardDepth)
 *   ③ 结论才转发(不转发工具过程/thinking)
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

// ── 运行时类型 ──────────────────────────────────────

interface ActiveGroupAgent {
  meta: GroupAgentMeta;
  session: AgentSession;
  busy: boolean;
  status: "idle" | "busy" | "offline";
  offlineReason?: string;
  /** 连续失败次数(达到阈值 → offline) */
  retries: number;
}

interface ActiveGroup {
  meta: GroupSessionMeta;
  /** 群聊统一 chatId——所有 Agent 事件注入它,前端群聊视图按此关联 */
  chatId: string;
  agents: ActiveGroupAgent[];
  /** 转发消息 ID 去重(防环①) */
  forwardSeen: Set<string>;
}

export interface GroupServiceDeps {
  store: Store;
  getAgentDir: () => string;
  buildTools: (projectPath: string, sessionId: string, chatId?: string) => Promise<{
    tools: ToolDefinition[];
    canUseTool: (toolName: string, input: Record<string, unknown>, options: CanUseToolOptions) => Promise<PermissionResult>;
  }>;
  buildSystemPrompt: (projectPath: string, templatePrompt: string) => string;
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
    opts?: { presetId?: string; message?: string },
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
      const { tools: extraTools, canUseTool } = await this.deps.buildTools(resolvedPath, tempSessionId, agentChatId);
      const systemPrompt = this.deps.buildSystemPrompt(resolvedPath, template?.prompt ?? "");

      const session = await createPiSession({
        cwd: resolvedPath,
        agentDir: this.deps.getAgentDir(),
        model,
        store: this.deps.store,
        systemPrompt,
        extraTools,
        canUseTool,
      });

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
      forwardSeen: new Set(),
    };
    this.groups.set(groupId, group);
    this.persist(group);

    if (opts?.message) {
      await this.sendGroupMessage(groupId, opts.message);
    }
    return { groupId, chatId };
  }

  // ── 消息路由 ──────────────────────────────────────

  /** 发送用户消息:@提及路由到目标 Agent,否则发给主 Agent(第一个) */
  async sendGroupMessage(groupId: string, text: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error("群聊不存在或已关闭");

    // 用户消息由前端本地 append(与单会话一致),这里不广播 user_message 防重复
    const targetIdx = this.resolveMention(group, text);
    const cleanText = stripMention(text);
    await this.promptAgent(group, targetIdx, cleanText, { depth: 0, messageId: `u-${randomUUID()}`, forwarded: false });
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

  // ── 回合驱动 + 转发 ───────────────────────────────

  private async promptAgent(
    group: ActiveGroup,
    idx: number,
    text: string,
    opts: { depth: number; messageId: string; forwarded: boolean },
  ): Promise<void> {
    const agent = group.agents[idx];
    if (!agent || agent.status === "offline") return;
    if (agent.busy) {
      console.log(`[group] ${agent.meta.role} busy, skip: ${text.slice(0, 40)}`);
      return;
    }
    agent.busy = true;
    agent.status = "busy";

    const session = agent.session;
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
            this.deps.broadcast("agent:stream", ev);
          },
          getSession: () => session,
          setPendingResult: (ev) => {
            if (ev.type === "turn_end") {
              // 回合结束 → 提取累计全文结论 → 转发给其他 Agent
              const conclusion = (session as any).getLastAssistantText?.() ?? "";
              this.onAgentTurnEnd(group, idx, String(conclusion || ""), opts);
            }
          },
        });
      } catch (e) {
        console.error("[group] bridge error:", e);
      }
    });

    try {
      if (opts.forwarded) {
        const mode = this.deps.store.getSettings().groupInjectMode ?? "followUp";
        if (mode === "steer") {
          await session.steer(text);
        } else {
          await session.followUp(text);
        }
      } else {
        await session.prompt(text);
      }
    } catch (err) {
      const msg = normalizeApiError(err);
      console.error(`[group] ${agent.meta.role} prompt error:`, err instanceof Error ? err.message : String(err));
      this.deps.broadcast("agent:stream", {
        type: "error", sessionId: agent.meta.sessionId, chatId: group.chatId,
        agentRole: agent.meta.role, message: msg,
      });
      // 失败处理:503/网络 → 重试 ≤3 → 标记 offline 跳过
      agent.retries += 1;
      if (agent.retries >= MAX_RETRIES) {
        agent.status = "offline";
        agent.offlineReason = `连续 ${MAX_RETRIES} 次失败`;
        this.deps.broadcast("agent:stream", {
          type: "status", sessionId: agent.meta.sessionId, chatId: group.chatId,
          agentRole: agent.meta.role, message: `${agent.meta.role} 已离线(连续失败),其他 Agent 不受影响`,
        });
      }
    } finally {
      unsub();
      agent.busy = false;
      if (agent.status === "busy") agent.status = "idle";
    }
  }

  /** 回合结束 → 结论转发给其他空闲 Agent(防环 + 深度控制) */
  private onAgentTurnEnd(
    group: ActiveGroup,
    fromIdx: number,
    conclusion: string,
    opts: { depth: number; messageId: string; forwarded: boolean },
  ): void {
    if (!conclusion.trim()) return;
    const settings = this.deps.store.getSettings();
    const strategy = settings.groupForwardStrategy ?? "conclusion";
    const maxDepth = settings.maxForwardDepth ?? 3;
    const fromAgent = group.agents[fromIdx];

    // 只转发"结论"(turn 结束的最终文本)。过程流(工具/thinking)已实时广播给前端展示,
    // 不注入其他 Agent 上下文(避免膨胀);all 策略此处与 conclusion 相同,留作未来全量转发
    if (strategy !== "conclusion" && strategy !== "all") return;

    const nextDepth = (opts.depth ?? 0) + 1;
    if (nextDepth > maxDepth) {
      this.deps.broadcast("agent:stream", {
        type: "status", sessionId: fromAgent.meta.sessionId, chatId: group.chatId,
        agentRole: fromAgent.meta.role, message: `已达最大转发链(${maxDepth}),停止自动转发`,
      });
      return;
    }

    // 防环①:消息 ID 去重(深度递增构成唯一链 ID)
    const msgId = `${opts.messageId}-${nextDepth}`;
    if (group.forwardSeen.has(msgId)) return;
    group.forwardSeen.add(msgId);

    const fromRole = fromAgent.meta.role;
    for (let i = 0; i < group.agents.length; i++) {
      if (i === fromIdx) continue;
      const target = group.agents[i];
      if (target.status === "offline") continue;
      if (target.busy) {
        console.log(`[group] ${target.meta.role} busy, 转发跳过(下条再转)`);
        continue;
      }
      console.log(`[group] forward ${fromRole} → ${target.meta.role} depth=${nextDepth}`);
      // 异步触发,不阻塞当前回合收尾
      void this.promptAgent(group, i, conclusion, { depth: nextDepth, messageId: msgId, forwarded: true });
    }
  }
}

/** 解析 @提及:移除消息开头/任意位置的 "@角色名" 前缀,返回纯净文本 */
function stripMention(text: string): string {
  return text.replace(/^\s*@[^\s:：，。,]+[:：]?\s*/, "").trim();
}
