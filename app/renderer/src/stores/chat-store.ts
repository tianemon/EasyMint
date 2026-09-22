import { create } from "zustand";
import type { ErrorTone } from "../../../shared/api-errors";

export type StoredMessage = Record<string, any> & { id: number; role: "user" | "ai" };

/** 消息流内持久错误卡片(3.5):错误除状态栏 8s 提示外,同时落入消息流,
 *  锚定在失败回合的消息下方,直到用户重试/手动关闭才消失。 */
export interface FlowErrorCard {
  id: number;
  kind: "send" | "round" | "system";
  message: string;
  /** 视觉档位,来自 classifyApiError;缺省按 error 渲染(见 FlowErrorCardView) */
  tone?: ErrorTone;
  /** 简短建议文案(可选,与 message 同卡第二行) */
  hint?: string;
  /** 卡片渲染在 anchorMsgId 对应消息的气泡下方 */
  anchorMsgId: number;
  /** 重试目标消息 id(重发该 user 消息);缺省 = 不可重试,仅可关闭 */
  sourceMsgId?: number;
  ts: number;
}

/** 单会话错误卡片数上限(防御极端重复错误事件撑爆内存/渲染) */
const MAX_FLOW_ERRORS_PER_SESSION = 20;

/** 气泡重新拿到内容（流式写入 / 编辑重发）→ 它又回到上下文里，清掉「已退出上下文」标记。
 *  与 setMessageEntryId 同一手法：删字段而不是置 undefined。 */
const asLive = (m: Record<string, any>): Record<string, any> => {
  const { outOfContext: _nowLive, ...rest } = m;
  return rest;
};

interface ChatState {
  messagesBySession: Record<string, any[]>;
  msgIdBySession: Record<string, number>;
  /** 按会话持久错误卡片(不进磁盘;会话加载/切换时随 evict 清理) */
  errorsBySession: Record<string, FlowErrorCard[]>;
  errorsIdBySession: Record<string, number>;

  /** 追加持久错误卡片(同消息+同文案去重,防重复错误事件堆卡片) */
  addFlowError: (sessionId: string, card: Omit<FlowErrorCard, "id" | "ts">) => void;
  /** 关闭单张错误卡片(重试成功/用户手动关闭) */
  dismissFlowError: (sessionId: string, id: number) => void;

  loadSession: (sessionId: string, messages: StoredMessage[]) => void;
  evictSession: (sessionId: string) => void;
  /** 追加用户消息,返回新消息 id(发送失败时错误卡片按它锚定重试) */
  appendUserMsg: (sessionId: string, msg: Record<string, any> & { role: "user" | "ai" }) => number;
  /** 替换指定 user 消息文本（编辑重发——打断后改原问题重发,不新增气泡） */
  updateUserMsgText: (sessionId: string, msgId: number, text: string) => void;
  /** 标记「已退出上下文」（撤回后本地列表不裁剪，见 ChatPanel.handleEditSubmit）：从 fromMsgId 起
   *  （includeFrom 为 true 时含它自己）之后的全部气泡打标——它们已不在当前分支上，界面据此显式说明，
   *  免得「界面顺序 = 上下文顺序」被误读。重开会话后它们随磁盘分支一起消失，标记只活在本面板内；
   *  气泡重新拿到内容时标记自动清掉（见 replaceAiEntriesById / updateUserMsgText）。 */
  markOutOfContext: (sessionId: string, fromMsgId: number, includeFrom?: boolean) => void;
  /** 按 Pi 落盘时间戳有序插入——插到第一条 piTs 更大的消息之前,否则追加尾部。
   *  实时渲染顺序 = jsonl 落盘顺序(广播到达顺序 ≠ 落盘顺序,不能按到达顺序追加) */
  insertUserMsgAt: (sessionId: string, msg: Record<string, any> & { role: "user" | "ai"; piTs?: number }, piTs: number) => number;
  replaceAiEntries: (sessionId: string, entries: Record<string, any>[]) => number;
  /** 按消息 id 全量替换 entries（Pi 帧是累计全文快照，替换而非拼接——见 Proma uuid 方案） */
  replaceAiEntriesById: (sessionId: string, msgId: number, entries: Record<string, any>[]) => number;
  /** 回合完成后挂 usage（message_end 事件携带的 token/缓存统计） */
  setMessageUsage: (sessionId: string, msgId: number, usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }) => void;
  /** 回填气泡的会话条目 id（entry_appended 事件——编辑/重新生成按它定位节点）。
   *  传 `undefined` = 清除：气泡被重发复用（编辑重发/错误重试）时，旧 id 指向的条目已失效
   *  （被撤回或不在分支上），必须清掉等新条目重新认领（见 ChatPanel.sendText / claimEntryBubble） */
  setMessageEntryId: (sessionId: string, msgId: number, entryId: string | undefined) => void;
  nextMsgId: (sessionId: string) => number;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: {},
  msgIdBySession: {},
  errorsBySession: {},
  errorsIdBySession: {},

  addFlowError: (sessionId, card) => {
    const list = get().errorsBySession[sessionId] || [];
    // 同锚点同文案已存在则不重复堆卡(重复错误事件只保留一张)
    const dup = list.some((c) => c.anchorMsgId === card.anchorMsgId && c.message === card.message);
    if (dup) return;
    const id = (get().errorsIdBySession[sessionId] || 0) + 1;
    const nextList = [...list, { ...card, id, ts: Date.now() }].slice(-MAX_FLOW_ERRORS_PER_SESSION);
    set((s) => ({
      errorsBySession: { ...s.errorsBySession, [sessionId]: nextList },
      errorsIdBySession: { ...s.errorsIdBySession, [sessionId]: id },
    }));
  },

  dismissFlowError: (sessionId, id) => {
    set((s) => ({
      errorsBySession: {
        ...s.errorsBySession,
        [sessionId]: (s.errorsBySession[sessionId] || []).filter((c) => c.id !== id),
      },
    }));
  },

  loadSession: (sessionId, messages) =>
    set((s) => {
      const existing = s.messagesBySession[sessionId] || [];
      if (existing.length === 0) {
        return {
          messagesBySession: { ...s.messagesBySession, [sessionId]: messages },
          msgIdBySession: { ...s.msgIdBySession, [sessionId]: Math.max(0, ...messages.map((m) => m.id)) },
        };
      }
      // Merge: prepend store-only messages (e.g. init prompt pre-written by handleCreate)
      // 排除 streaming 标记的流式临时消息——磁盘数据是最终真相，加载后流式消息被替代（否则重复显示）
      const existingIds = new Set(messages.map((m: { id: number }) => m.id));
      const storeOnly = existing.filter((m: { id: number; streaming?: boolean }) => !existingIds.has(m.id) && !m.streaming);
      const merged = [...storeOnly, ...messages].sort((a: { id: number }, b: { id: number }) => a.id - b.id);
      return {
        messagesBySession: { ...s.messagesBySession, [sessionId]: merged },
        msgIdBySession: { ...s.msgIdBySession, [sessionId]: Math.max(0, ...merged.map((m: { id: number }) => m.id)) },
      };
    }),

  evictSession: (sessionId) =>
    set((s) => {
      const next = { ...s.messagesBySession };
      delete next[sessionId];
      const nextId = { ...s.msgIdBySession };
      delete nextId[sessionId];
      const nextErrors = { ...s.errorsBySession };
      delete nextErrors[sessionId];
      const nextErrId = { ...s.errorsIdBySession };
      delete nextErrId[sessionId];
      return { messagesBySession: next, msgIdBySession: nextId, errorsBySession: nextErrors, errorsIdBySession: nextErrId };
    }),

  appendUserMsg: (sessionId, msg) => {
    const id = get().nextMsgId(sessionId);
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] || []), { ...msg, id }],
      },
    }));
    return id;
  },

  /** 替换指定 user 消息的文本（编辑重发用——发送后打断,改原问题重发,不产生新气泡）。
   *  附件**保留**：编辑框只改文本，重发以气泡为准（sendText 的 sourceMsgId 路径直接取气泡的 attaches），
   *  清掉 attaches 会静默丢掉图片/文档，还会把输入框里当时的其它附件错带上去。 */
  updateUserMsgText: (sessionId, msgId, text) => {
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: (s.messagesBySession[sessionId] || []).map((m) =>
          m.id === msgId ? { ...asLive(m), text } : m
        ),
      },
    }));
  },

  markOutOfContext: (sessionId, fromMsgId, includeFrom) => {
    set((s) => {
      const list = s.messagesBySession[sessionId] || [];
      const idx = list.findIndex((m: { id: number }) => m.id === fromMsgId);
      if (idx < 0) return {};
      const from = includeFrom ? idx : idx + 1;
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: list.map((m, i) => (i >= from ? { ...m, outOfContext: true } : m)),
        },
      };
    });
  },

  insertUserMsgAt: (sessionId, msg, piTs) => {
    const id = get().nextMsgId(sessionId);
    set((s) => {
      const list = s.messagesBySession[sessionId] || [];
      // 无 piTs 的历史消息视为 -Infinity(已加载的磁盘消息位置固定,新消息只在其后插入)
      const idx = list.findIndex((m) => (m.piTs ?? -Infinity) > piTs);
      const next = idx === -1
        ? [...list, { ...msg, piTs, id }]
        : [...list.slice(0, idx), { ...msg, piTs, id }, ...list.slice(idx)];
      return { messagesBySession: { ...s.messagesBySession, [sessionId]: next } };
    });
    return id;
  },

  replaceAiEntries: (sessionId: string, entries: Record<string, any>[]) => {
    const msgs = get().messagesBySession[sessionId] || [];
    const last = msgs[msgs.length - 1];
    if (last && last.role === "ai") {
      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: (s.messagesBySession[sessionId] || []).map((m) =>
            m.id === last.id ? { ...asLive(m), entries } : m
          ),
        },
      }));
      return last.id;
    }
    const msgId = get().nextMsgId(sessionId);
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] || []), { id: msgId, role: "ai" as const, entries, timestamp: Date.now(), streaming: true }],
      },
    }));
    return msgId;
  },

  replaceAiEntriesById: (sessionId: string, msgId: number, entries: Record<string, any>[]) => {
    const msgs = get().messagesBySession[sessionId] || [];
    const target = msgs.find((m) => m.id === msgId);
    if (target && target.role === "ai") {
      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: (s.messagesBySession[sessionId] || []).map((m) =>
            // 流式写入 = 这条气泡是新回答的载体 → 抹掉「已退出上下文」（编辑/重新生成后新回答
            // 可能落在被撤回的那条旧气泡上，标记留着会把当前回答误标成已退出上下文）
            m.id === msgId ? { ...asLive(m), entries } : m
          ),
        },
      }));
      return msgId;
    }
    // 消息不存在（会话重载等竞态）→ 回退：替换最后一条 AI 或新建
    return get().replaceAiEntries(sessionId, entries);
  },

  setMessageUsage: (sessionId, msgId, usage) => {
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: (s.messagesBySession[sessionId] || []).map((m) =>
          m.id === msgId ? { ...m, usage } : m
        ),
      },
    }));
  },

  setMessageEntryId: (sessionId, msgId, entryId) => {
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: (s.messagesBySession[sessionId] || []).map((m) => {
          if (m.id !== msgId) return m;
          if (entryId === undefined) {
            // 删掉字段而不是置 undefined——认领规则用 `!m.entryId` 判未认领，两种写法等价，
            // 但删字段让「这个气泡没有 id」在调试/序列化里都是同一件事
            const { entryId: _cleared, ...rest } = m;
            return rest;
          }
          // 认领到新条目 = 这条又重新在上下文里了 → 抹掉「已退出上下文」（复用气泡重发、重试都走这里）
          return { ...asLive(m), entryId };
        }),
      },
    }));
  },

  nextMsgId: (sessionId) => {
    const next = (get().msgIdBySession[sessionId] || 0) + 1;
    set((s) => ({ msgIdBySession: { ...s.msgIdBySession, [sessionId]: next } }));
    return next;
  },
}));
