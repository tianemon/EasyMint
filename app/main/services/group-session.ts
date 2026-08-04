/**
 * 群聊会话容器(需求 4:多 Agent 同一会话,应用层消息转发,方案 B)
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
}

export interface GroupServiceDeps {
  store: Store;
  getAgentDir: () => string;
  /** 按模板 tools 声明构建群聊 Agent 工具集(基础 coding 工具由 createPiSession 强制追加) */
  buildGroupTools: (projectPath: string, sessionId: string, chatId: string | undefined, templateTools: string[]) => Promise<{
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
      const systemPrompt = this.deps.buildSystemPrompt(resolvedPath, template?.prompt ?? "");

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
    await this.promptAgent(group, targetIdx, cleanText, { depth: 0, forwarded: false });
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

      // 转发/用户消息统一用 prompt 开启新回合——followUp/steer 需 session 有活动回合,
      // 群聊 Agent(新建 session)首次收到转发时无 active turn,用 followUp 不会产生输出
      // (busy 目标的排队注入走 injectQueued 的 followUp,那是有活动回合的场景)
      const body = opts.forwarded && opts.fromRole ? `[来自 ${opts.fromRole} 的消息]\n${text}` : text;
      const send = session.prompt(body);
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

  /** 回合结束 → 结论转发给其他 Agent(防环:maxForwardDepth + 只转结论) */
  private onAgentTurnEnd(
    group: ActiveGroup,
    fromIdx: number,
    conclusion: string,
    opts: { depth: number; forwarded: boolean; fromRole?: string },
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

    const fromRole = fromAgent.meta.role;
    for (let i = 0; i < group.agents.length; i++) {
      if (i === fromIdx) continue;
      const target = group.agents[i];
      if (target.status === "offline") continue;
      if (target.busy) {
        // 目标忙碌 → 排队注入(followUp 等空闲后发出),不阻塞当前收尾;
        // 排队回合不触发转发链(避免 busy 队列链式爆炸),输出仅展示
        console.log(`[group] ${target.meta.role} busy, 排队注入`);
        this.injectQueued(group, i, conclusion, fromRole);
        continue;
      }
      console.log(`[group] forward ${fromRole} → ${target.meta.role} depth=${nextDepth}`);
      // 异步触发,不阻塞当前回合收尾
      void this.promptAgent(group, i, conclusion, { depth: nextDepth, forwarded: true, fromRole });
    }
  }

  /** 目标 Agent 忙碌时的排队注入:挂临时 subscribe 只广播事件,turn_end 后退订;
      不设 busy 标志、不触发转发链——由目标自身回合接管后续 */
  private injectQueued(group: ActiveGroup, idx: number, text: string, fromRole?: string): void {
    const agent = group.agents[idx];
    if (!agent || agent.status === "offline") return;
    const body = fromRole ? `[来自 ${fromRole} 的消息]\n${text}` : text;
    const session = agent.session;
    const unsub = session.subscribe((event) => {
      try {
        bridgeSessionEvents(event, {
          onEvent: (ev) => {
            ev.sessionId = agent.meta.sessionId;
            ev.chatId = group.chatId;
            (ev as any).groupId = group.meta.groupId;
            (ev as any).agentRole = agent.meta.role;
            (ev as any).forwarded = true;
            (ev as any).forwardedFrom = fromRole;
            this.deps.broadcast("agent:stream", ev);
          },
          getSession: () => session,
          setPendingResult: (ev) => {
            if (ev.type === "turn_end") {
              // 排队回合结束同样广播 turn_end,前端清 busy(不触发转发链)
              ev.sessionId = agent.meta.sessionId;
              ev.chatId = group.chatId;
              (ev as any).groupId = group.meta.groupId;
              (ev as any).agentRole = agent.meta.role;
              (ev as any).forwarded = true;
              (ev as any).forwardedFrom = fromRole;
              this.deps.broadcast("agent:stream", ev);
            }
          },
        });
      } catch (e) {
        console.error("[group] queued bridge error:", e);
      }
    });
    const send = this.deps.store.getSettings().groupInjectMode === "steer"
      ? session.steer(body)      // 打断当前回合
      : session.followUp(body);  // 排队等空闲
    send.catch((e) => {
      console.error(`[group] ${agent.meta.role} queued followUp failed:`, (e as Error).message);
    }).finally(() => unsub());
  }
}

/** 解析 @提及:移除消息开头/任意位置的 "@角色名" 前缀,返回纯净文本 */
function stripMention(text: string): string {
  return text.replace(/^\s*@[^\s:：，。,]+[:：]?\s*/, "").trim();
}
