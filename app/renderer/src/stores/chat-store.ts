import { create } from "zustand";

export type StoredMessage = Record<string, any> & { id: number; role: "user" | "ai" };

/** 消息流内持久错误卡片(3.5):错误除状态栏 8s 提示外,同时落入消息流,
 *  锚定在失败回合的消息下方,直到用户重试/手动关闭才消失。 */
export interface FlowErrorCard {
  id: number;
  kind: "send" | "round" | "system";
  message: string;
  /** 卡片渲染在 anchorMsgId 对应消息的气泡下方 */
  anchorMsgId: number;
  /** 重试目标消息 id(重发该 user 消息);缺省 = 不可重试,仅可关闭 */
  sourceMsgId?: number;
  ts: number;
}

/** 单会话错误卡片数上限(防御极端重复错误事件撑爆内存/渲染) */
const MAX_FLOW_ERRORS_PER_SESSION = 20;

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
  /** 按 Pi 落盘时间戳有序插入——插到第一条 piTs 更大的消息之前,否则追加尾部。
   *  实时渲染顺序 = jsonl 落盘顺序(广播到达顺序 ≠ 落盘顺序,不能按到达顺序追加) */
  insertUserMsgAt: (sessionId: string, msg: Record<string, any> & { role: "user" | "ai"; piTs?: number }, piTs: number) => number;
  replaceAiEntries: (sessionId: string, entries: Record<string, any>[]) => number;
  /** 按消息 id 全量替换 entries（Pi 帧是累计全文快照，替换而非拼接——见 Proma uuid 方案） */
  replaceAiEntriesById: (sessionId: string, msgId: number, entries: Record<string, any>[]) => number;
  /** 回合完成后挂 usage（message_end 事件携带的 token/缓存统计） */
  setMessageUsage: (sessionId: string, msgId: number, usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }) => void;
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

  /** 替换指定 user 消息的文本（编辑重发用——发送后打断,改原问题重发,不产生新气泡） */
  updateUserMsgText: (sessionId, msgId, text) => {
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: (s.messagesBySession[sessionId] || []).map((m) =>
          m.id === msgId ? { ...m, text, attaches: undefined } : m
        ),
      },
    }));
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
            m.id === last.id ? { ...m, entries } : m
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
            m.id === msgId ? { ...m, entries } : m
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

  nextMsgId: (sessionId) => {
    const next = (get().msgIdBySession[sessionId] || 0) + 1;
    set((s) => ({ msgIdBySession: { ...s.msgIdBySession, [sessionId]: next } }));
    return next;
  },
}));
