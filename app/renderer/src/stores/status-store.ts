import { create } from "zustand";

/** ChatPanel 状态栏的独立 store——密集更新时只重渲染状态栏，不牵连 ChatPanel/消息列表 */
interface StatusState {
  text: string;
  summarizing: boolean;
  compacting: boolean;
  ctxPct: number;
  setText: (t: string) => void;
  setSummarizing: (v: boolean) => void;
  setCompacting: (v: boolean) => void;
  setCtxPct: (p: number) => void;
  reset: () => void;
}

export const useStatusStore = create<StatusState>((set) => ({
  text: "",
  summarizing: false,
  compacting: false,
  ctxPct: 0,
  setText: (t) => set({ text: t }),
  setSummarizing: (v) => set({ summarizing: v }),
  setCompacting: (v) => set({ compacting: v }),
  setCtxPct: (p) => set({ ctxPct: p }),
  reset: () => set({ text: "", summarizing: false, compacting: false, ctxPct: 0 }),
}));
