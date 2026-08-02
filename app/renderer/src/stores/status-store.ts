import { create } from "zustand";

/**
 * ChatPanel 状态栏的独立 store——密集更新时只重渲染状态栏，不牵连 ChatPanel/消息列表
 *
 * 状态 = 信号栈（先来后到 + 各自生命周期）:
 *  - pushSignal(id, text, ttl?):信号到达(同 id 更新文本不重复占位);显示最新到达的活跃信号
 *  - popSignal(id):信号结束 → 回退显示次新且仍活跃的信号
 *  - 无显式结束事件的信号(error/request)用 ttl 兜底自动 pop
 */

interface StatusSignal {
  id: string;
  text: string;
  seq: number;
}

interface StatusState {
  text: string;
  signals: StatusSignal[];
  summarizing: boolean;
  compacting: boolean;
  ctxPct: number;
  pushSignal: (id: string, text: string, ttlMs?: number) => void;
  popSignal: (id: string) => void;
  setSummarizing: (v: boolean) => void;
  setCompacting: (v: boolean) => void;
  setCtxPct: (p: number) => void;
  reset: () => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seqCounter = 0;

/** 派生显示文本:最新 seq 的活跃信号 */
function deriveText(signals: StatusSignal[]): string {
  if (signals.length === 0) return "";
  return [...signals].sort((a, b) => b.seq - a.seq)[0]!.text;
}

export const useStatusStore = create<StatusState>((set, get) => ({
  text: "",
  signals: [],
  summarizing: false,
  compacting: false,
  ctxPct: 0,

  pushSignal: (id, text, ttlMs) => {
    // [临时调试] 信号入栈
    console.log("[status-signal] push", id, JSON.stringify(text));
    const cur = get().signals;
    let signals: StatusSignal[];
    if (cur.some((s) => s.id === id)) {
      // 同 id:更新文本,保留原 seq(同信号不重复占位)
      signals = cur.map((s) => (s.id === id ? { ...s, text } : s));
    } else {
      seqCounter++;
      signals = [...cur, { id, text, seq: seqCounter }];
    }
    const old = timers.get(id);
    if (old) clearTimeout(old);
    if (ttlMs) {
      timers.set(id, setTimeout(() => get().popSignal(id), ttlMs));
    }
    set({ signals, text: deriveText(signals) });
  },

  popSignal: (id) => {
    // [临时调试] 信号出栈
    console.log("[status-signal] pop", id);
    const signals = get().signals.filter((s) => s.id !== id);
    const old = timers.get(id);
    if (old) { clearTimeout(old); timers.delete(id); }
    set({ signals, text: deriveText(signals) });
  },

  setSummarizing: (v) => set({ summarizing: v }),
  setCompacting: (v) => set({ compacting: v }),
  setCtxPct: (p) => set({ ctxPct: p }),
  reset: () => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    seqCounter = 0;
    set({ text: "", signals: [], summarizing: false, compacting: false, ctxPct: 0 });
  },
}));
