import { create } from "zustand";

/** ask_user 广播的问题定义（主进程透传） */
export interface AskQuestion {
  id: string;
  question: string;
  options?: Array<{ value: string; label: string; description?: string }>;
  multi_select?: boolean;
  /** 级联条件：{前置问题id: 选项value}，前置选择匹配才显示本问题 */
  depends_on?: Record<string, string>;
}

export interface AskRequest {
  requestId: string;
  sessionId: string;
  questions: AskQuestion[];
  allowCustom: boolean;
}

interface AskState {
  /** requestId → 请求（pending ask；同会话同时只应有一个） */
  asks: Record<string, AskRequest>;
  setAsk: (req: AskRequest) => void;
  clearAsk: (requestId: string) => void;
  clearForSession: (sessionId: string) => void;
}

export const useAskStore = create<AskState>((set) => ({
  asks: {},
  setAsk: (req) => set((s) => ({ asks: { ...s.asks, [req.requestId]: req } })),
  clearAsk: (requestId) =>
    set((s) => {
      const next = { ...s.asks };
      delete next[requestId];
      return { asks: next };
    }),
  clearForSession: (sessionId) =>
    set((s) => {
      const next = { ...s.asks };
      for (const k in next) if (next[k]!.sessionId === sessionId) delete next[k];
      return { asks: next };
    }),
}));
