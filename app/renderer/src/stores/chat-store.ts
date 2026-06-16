import { create } from "zustand";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StoredMessage = Record<string, any> & { id: number; role: "user" | "ai" };

interface ChatState {
  messagesBySession: Record<string, any[]>;
  msgIdBySession: Record<string, number>;

  loadSession: (sessionId: string, messages: StoredMessage[]) => void;
  evictSession: (sessionId: string) => void;
  appendUserMsg: (sessionId: string, msg: Record<string, any> & { role: "user" | "ai" }) => void;
  appendAiEntry: (sessionId: string, entry: Record<string, any>) => number;
  nextMsgId: (sessionId: string) => number;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: {},
  msgIdBySession: {},

  loadSession: (sessionId, messages) =>
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: messages },
      msgIdBySession: { ...s.msgIdBySession, [sessionId]: Math.max(0, ...messages.map((m) => m.id)) },
    })),

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

  appendAiEntry: (sessionId, entry) => {
    const msgs = get().messagesBySession[sessionId] || [];
    const last = msgs[msgs.length - 1];
    let msgId: number;
    if (last && last.role === "ai") {
      msgId = last.id;
      set((s) => {
        const cur = s.messagesBySession[sessionId];
        if (!cur) return {};
        return {
          messagesBySession: {
            ...s.messagesBySession,
            [sessionId]: cur.map((m) => (m.id === msgId ? { ...m, entries: [...(m.entries || []), entry] } : m)),
          },
        };
      });
    } else {
      msgId = get().nextMsgId(sessionId);
      set((s) => ({
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...(s.messagesBySession[sessionId] || []), { id: msgId, role: "ai" as const, entries: [entry], timestamp: entry.timestamp || Date.now() }],
        },
      }));
    }
    return msgId;
  },

  nextMsgId: (sessionId) => {
    const next = (get().msgIdBySession[sessionId] || 0) + 1;
    set((s) => ({ msgIdBySession: { ...s.msgIdBySession, [sessionId]: next } }));
    return next;
  },
}));
