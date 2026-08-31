import { create } from "zustand";

/** learn 审阅请求（主进程 learn-request 广播透传） */
export interface LearnSkillDraft {
  action: "create" | "update";
  name: string;
  description: string;
  body: string;
}

export interface LearnRequest {
  requestId: string;
  sessionId: string;
  memory: string;
  context?: string;
  skill?: LearnSkillDraft;
}

interface LearnState {
  /** requestId → 请求（pending learn；同会话同时只应有一个） */
  learns: Record<string, LearnRequest>;
  setLearn: (req: LearnRequest) => void;
  clearLearn: (requestId: string) => void;
  clearForSession: (sessionId: string) => void;
}

export const useLearnStore = create<LearnState>((set) => ({
  learns: {},
  setLearn: (req) => set((s) => ({ learns: { ...s.learns, [req.requestId]: req } })),
  clearLearn: (requestId) =>
    set((s) => {
      const next = { ...s.learns };
      delete next[requestId];
      return { learns: next };
    }),
  clearForSession: (sessionId) =>
    set((s) => {
      const next = { ...s.learns };
      for (const k in next) if (next[k]!.sessionId === sessionId) delete next[k];
      return { learns: next };
    }),
}));
