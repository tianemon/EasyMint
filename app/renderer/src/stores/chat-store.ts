import { create } from "zustand";

export type StoredMessage = Record<string, any> & { id: number; role: "user" | "ai" };

/** 剥离注入标签（时间戳、命令 XML 包裹），保留用户原始文本 */
const cleanUserText = (text?: string): string =>
  (text || "")
    .replace(/<current_time>[^<]*<\/current_time>\n\n?/g, "")
    .replace(/<command-name>[^<]*<\/command-name>\n?/g, "")
    .replace(/<local-command-caveat>[^<]*<\/local-command-caveat>\n?/g, "")
    .replace(/<local-command-stdout>[^<]*<\/local-command-stdout>\n?/g, "")
    .replace(/<command-message>[^<]*<\/command-message>\n?/g, "");

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
    set((s) => {
      const cleaned = messages.map((m) => (m.role === "user" ? { ...m, text: cleanUserText(m.text) } : m));
      const existing = s.messagesBySession[sessionId] || [];
      if (existing.length === 0) {
        return {
          messagesBySession: { ...s.messagesBySession, [sessionId]: cleaned },
          msgIdBySession: { ...s.msgIdBySession, [sessionId]: Math.max(0, ...cleaned.map((m) => m.id)) },
        };
      }
      // Merge: prepend store-only messages (e.g. init prompt pre-written by handleCreate)
      const existingIds = new Set(cleaned.map((m: { id: number }) => m.id));
      const storeOnly = existing.filter((m: { id: number }) => !existingIds.has(m.id));
      const merged = [...storeOnly, ...cleaned].sort((a: { id: number }, b: { id: number }) => a.id - b.id);
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
    const cleanMsg = msg.role === "user" && msg.text ? { ...msg, text: cleanUserText(msg.text) } : msg;
    return set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] || []), { ...cleanMsg, id }],
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
