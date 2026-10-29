import { create } from "zustand";

/**
 * ChatPanel 状态栏的独立 store——密集更新时只重渲染状态栏，不牵连 ChatPanel/消息列表
 *
 * 状态 = 按会话隔离的信号栈(先来后到 + 各自生命周期):
 *  - pushSignal(sessionId, id, text, ttl?):信号到达(同 id 更新文本不重复占位);显示最新到达的活跃信号
 *  - popSignal(sessionId, id):信号结束 → 回退显示次新且仍活跃的信号
 *  - 无显式结束事件的信号(error/request)用 ttl 兜底自动 pop
 *  - 会话隔离:多 tab 各 ChatPanel 的信号互不穿透(跨会话状态展示不污染)
 */

export interface ToolStatus { name: string; args?: Record<string, unknown> }

interface StatusSignal {
  id: string;
  text: string;
  seq: number;
  tool?: ToolStatus;
}

interface SessionStatus {
  signals: StatusSignal[];
  summarizing: boolean;
  compacting: boolean;
  /** 上下文使用率(null = 未知:压缩后尚无新回复,不显示 0 误导) */
  ctxPct: number | null;
  /** 当前模型的上下文窗口(token);改模型参数后随之更新,hover 显示用 */
  ctxWindow: number | null;
}

interface StatusState {
  /** 会话 → 状态 */
  bySession: Record<string, SessionStatus>;
  pushSignal: (sessionId: string, id: string, text: string, ttlMs?: number, tool?: ToolStatus) => void;
  popSignal: (sessionId: string, id: string) => void;
  /** 按 id 前缀清理(回合结束时清除全部 tool:* 信号) */
  popSignalsByPrefix: (sessionId: string, prefix: string) => void;
  setSummarizing: (sessionId: string, v: boolean) => void;
  setCompacting: (sessionId: string, v: boolean) => void;
  /** p 为 undefined = 只更新窗口、百分比保持原值(仅窗口变化时用) */
  setCtxPct: (sessionId: string, p: number | null | undefined, windowTokens?: number | null) => void;
  reset: (sessionId?: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seqCounter = 0;

const emptyStatus = (): SessionStatus => ({ signals: [], summarizing: false, compacting: false, ctxPct: null, ctxWindow: null });

function timerKey(sessionId: string, id: string): string {
  return `${sessionId}\u0000${id}`;
}

export const useStatusStore = create<StatusState>((set, get) => ({
  bySession: {},

  pushSignal: (sessionId, id, text, ttlMs, tool) => {
    const cur = get().bySession[sessionId] ?? emptyStatus();
    let signals: StatusSignal[];
    const seq = ++seqCounter;
    if (cur.signals.some((s) => s.id === id)) {
      signals = cur.signals.map((s) => (s.id === id ? { ...s, text, seq, tool: tool ? { name: tool.name, args: tool.args ?? s.tool?.args } : s.tool } : s));
    } else {
      signals = [...cur.signals, { id, text, seq, tool }];
    }
    const key = timerKey(sessionId, id);
    const old = timers.get(key);
    if (old) clearTimeout(old);
    if (ttlMs) {
      timers.set(key, setTimeout(() => get().popSignal(sessionId, id), ttlMs));
    }
    const next: SessionStatus = { ...cur, signals };
    set({ bySession: { ...get().bySession, [sessionId]: next } });
  },

  popSignal: (sessionId, id) => {
    const cur = get().bySession[sessionId];
    if (!cur) return;
    const signals = cur.signals.filter((s) => s.id !== id);
    const key = timerKey(sessionId, id);
    const old = timers.get(key);
    if (old) { clearTimeout(old); timers.delete(key); }
    const next: SessionStatus = { ...cur, signals };
    set({ bySession: { ...get().bySession, [sessionId]: next } });
  },

  popSignalsByPrefix: (sessionId, prefix) => {
    const cur = get().bySession[sessionId];
    if (!cur) return;
    const signals = cur.signals.filter((s) => !s.id.startsWith(prefix));
    for (const s of cur.signals) {
      if (s.id.startsWith(prefix)) {
        const key = timerKey(sessionId, s.id);
        const old = timers.get(key);
        if (old) { clearTimeout(old); timers.delete(key); }
      }
    }
    const next: SessionStatus = { ...cur, signals };
    set({ bySession: { ...get().bySession, [sessionId]: next } });
  },

  setSummarizing: (sessionId, v) => {
    const cur = get().bySession[sessionId] ?? emptyStatus();
    set({ bySession: { ...get().bySession, [sessionId]: { ...cur, summarizing: v } } });
  },

  setCompacting: (sessionId, v) => {
    const cur = get().bySession[sessionId] ?? emptyStatus();
    set({ bySession: { ...get().bySession, [sessionId]: { ...cur, compacting: v } } });
  },

  setCtxPct: (sessionId, p, windowTokens) => {
    const cur = get().bySession[sessionId] ?? emptyStatus();
    // windowTokens 省略(undefined)时保留原值——多数事件只更新百分比
    const ctxWindow = windowTokens === undefined ? cur.ctxWindow : windowTokens;
    const ctxPct = p === undefined ? cur.ctxPct : p;
    set({ bySession: { ...get().bySession, [sessionId]: { ...cur, ctxPct, ctxWindow } } });
  },

  reset: (sessionId) => {
    if (sessionId) {
      // 只清指定会话(卸载/挂载时不影响其他会话的状态)
      const cur = get().bySession[sessionId];
      if (cur) {
        for (const s of cur.signals) {
          const key = timerKey(sessionId, s.id);
          const old = timers.get(key);
          if (old) { clearTimeout(old); timers.delete(key); }
        }
      }
      const bySession = { ...get().bySession };
      delete bySession[sessionId];
      set({ bySession });
    } else {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      seqCounter = 0;
      set({ bySession: {} });
    }
  },
}));
