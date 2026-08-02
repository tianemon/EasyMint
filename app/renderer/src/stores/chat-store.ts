import { create } from "zustand";

export type StoredMessage = Record<string, any> & { id: number; role: "user" | "ai" };


interface ChatState {
  messagesBySession: Record<string, any[]>;
  msgIdBySession: Record<string, number>;

  loadSession: (sessionId: string, messages: StoredMessage[]) => void;
  evictSession: (sessionId: string) => void;
  appendUserMsg: (sessionId: string, msg: Record<string, any> & { role: "user" | "ai" }) => void;
  replaceAiEntries: (sessionId: string, entries: Record<string, any>[]) => number;
  /** 替换最后一条 AI 消息中 fromIdx 之后的 entries（保留 fromIdx 之前的旧 turn 内容） */
  replaceAiEntriesFrom: (sessionId: string, fromIdx: number, entries: Record<string, any>[]) => number;
  /** Pi 新 turn 开始时调用，强制创建新的空 AI 消息（防止跨 turn 覆盖） */
  startAiMessage: (sessionId: string) => number;
  appendAiEntry: (sessionId: string, entry: Record<string, any>) => number;
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

  replaceAiEntriesFrom: (sessionId: string, fromIdx: number, entries: Record<string, any>[]) => {
    const msgs = get().messagesBySession[sessionId] || [];
    const last = msgs[msgs.length - 1];
    if (last && last.role === "ai") {
      const existing: Record<string, any>[] = last.entries || [];
      // 保留 fromIdx 之前的旧 turn 内容，替换 fromIdx 之后的内容
      // fromIdx 可能因竞态超出 existing 长度，cap 住防止旧内容泄露
      const safeIdx = Math.min(fromIdx, existing.length);
      const merged = [...existing.slice(0, safeIdx), ...entries];
      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: (s.messagesBySession[sessionId] || []).map((m) =>
            m.id === last.id ? { ...m, entries: merged } : m
          ),
        },
      }));
      return last.id;
    }
    // 没有 AI 消息 → 新建
    const msgId = get().nextMsgId(sessionId);
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] || []), { id: msgId, role: "ai" as const, entries, timestamp: Date.now(), streaming: true }],
      },
    }));
    return msgId;
  },

  appendAiEntry: (sessionId, entry) => {
    const msgs = get().messagesBySession[sessionId] || [];
    const last = msgs[msgs.length - 1];
    let msgId: number;
    if (last && last.role === "ai") {
      msgId = last.id;
      set((s) => {
        const cur = s.messagesBySession[sessionId];
        if (!cur) return {};
        const existing = last.entries || [];
        // 文本条目：拼接到已有文本，不重复创建
        if (entry.kind === "text") {
          const textIdx = existing.findIndex((e: Record<string, any>) => e.kind === "text");
          const updated = [...existing];
          if (textIdx >= 0) {
            updated[textIdx] = { ...updated[textIdx], text: (updated[textIdx].text || "") + (entry.text || "") };
          } else {
            updated.push(entry);
          }
          return {
            messagesBySession: {
              ...s.messagesBySession,
              [sessionId]: cur.map((m) => (m.id === msgId ? { ...m, entries: updated } : m)),
            },
          };
        }
        // 思考条目：Pi SDK 每帧发累积全文，替换已有思考文本，不重复创建
        if (entry.kind === "thinking") {
          const thinkIdx = existing.findIndex((e: Record<string, any>) => e.kind === "thinking");
          const updated = [...existing];
          if (thinkIdx >= 0) {
            updated[thinkIdx] = { ...updated[thinkIdx], text: entry.text || "" };
          } else {
            updated.push(entry);
          }
          return {
            messagesBySession: {
              ...s.messagesBySession,
              [sessionId]: cur.map((m) => (m.id === msgId ? { ...m, entries: updated } : m)),
            },
          };
        }
        // 非文本条目：直接追加
        return {
          messagesBySession: {
            ...s.messagesBySession,
            [sessionId]: cur.map((m) => (m.id === msgId ? { ...m, entries: [...existing, entry] } : m)),
          },
        };
      });
    } else {
      msgId = get().nextMsgId(sessionId);
      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...(s.messagesBySession[sessionId] || []), { id: msgId, role: "ai" as const, entries: [entry], timestamp: entry.timestamp || Date.now(), streaming: true }],
        },
      }));
    }
    return msgId;
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
