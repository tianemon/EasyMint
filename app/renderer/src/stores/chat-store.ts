import { create } from "zustand";

export type StoredMessage = Record<string, any> & { id: number; role: "user" | "ai" };


interface ChatState {
  messagesBySession: Record<string, any[]>;
  msgIdBySession: Record<string, number>;

  loadSession: (sessionId: string, messages: StoredMessage[]) => void;
  evictSession: (sessionId: string) => void;
  appendUserMsg: (sessionId: string, msg: Record<string, any> & { role: "user" | "ai" }) => void;
  /** 插到指定消息之前(系统通知插到其触发的回合锚点前——Pi turn_start 先于 message_start) */
  insertUserMsgBefore: (sessionId: string, anchorId: number, msg: Record<string, any> & { role: "user" | "ai" }) => void;
  replaceAiEntries: (sessionId: string, entries: Record<string, any>[]) => number;
  /** 按消息 id 全量替换 entries（Pi 帧是累计全文快照，替换而非拼接——见 Proma uuid 方案） */
  replaceAiEntriesById: (sessionId: string, msgId: number, entries: Record<string, any>[]) => number;
  /** Pi 新 turn 开始时调用，创建新的空 AI 消息作为本 turn 的锚点 */
  startAiMessage: (sessionId: string) => number;
  nextMsgId: (sessionId: string) => number;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: {},
  msgIdBySession: {},

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
      return { messagesBySession: next, msgIdBySession: nextId };
    }),

  appendUserMsg: (sessionId, msg) => {
    const id = get().nextMsgId(sessionId);
    return set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] || []), { ...msg, id }],
      },
    }));
  },

  insertUserMsgBefore: (sessionId, anchorId, msg) => {
    const id = get().nextMsgId(sessionId);
    return set((s) => {
      const msgs = s.messagesBySession[sessionId] || [];
      const idx = msgs.findIndex((m) => m.id === anchorId);
      const next = idx >= 0
        ? [...msgs.slice(0, idx), { ...msg, id }, ...msgs.slice(idx)]
        : [...msgs, { ...msg, id }];
      return { messagesBySession: { ...s.messagesBySession, [sessionId]: next } };
    });
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

  startAiMessage: (sessionId) => {
    const msgId = get().nextMsgId(sessionId);
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] || []), { id: msgId, role: "ai" as const, entries: [] as Record<string, any>[], timestamp: Date.now(), streaming: true }],
      },
    }));
    return msgId;
  },

  nextMsgId: (sessionId) => {
    const next = (get().msgIdBySession[sessionId] || 0) + 1;
    set((s) => ({ msgIdBySession: { ...s.msgIdBySession, [sessionId]: next } }));
    return next;
  },
}));
