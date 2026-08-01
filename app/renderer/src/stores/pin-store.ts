import { create } from "zustand";

export interface Pin {
  id: string;
  content: string;
  title: string;
  x: number; // -1 = 未定位（PinLayer 测量容器后分配默认位置）
  y: number;
  width?: number;  // 缺省 320
  height?: number; // 缺省 auto（内容撑开）
  createdAt: number;
}

/** 标题：首个非空行去 Markdown 符号，取前 20 字 */
function makeTitle(content: string): string {
  const firstLine = content.split("\n").find((l) => l.trim()) || "";
  const clean = firstLine.replace(/^#+\s*/, "").replace(/[*_`~]/g, "").trim();
  return clean.slice(0, 20) || "便签";
}

interface PinState {
  pinsBySession: Record<string, Pin[]>;
  loadPins: (sessionId: string, pins: Pin[]) => void;
  addPin: (sessionId: string, content: string) => void;
  removePin: (sessionId: string, pinId: string) => void;
  movePin: (sessionId: string, pinId: string, x: number, y: number) => void;
  resizePin: (sessionId: string, pinId: string, width: number, height: number) => void;
  bringToFront: (sessionId: string, pinId: string) => void;
  migrateSession: (oldSid: string, newSid: string) => void;
  /** 全量持久化到磁盘（拖动结束 / 默认定位后显式调用） */
  persistPins: (sessionId: string) => void;
}

export const usePinStore = create<PinState>((set, get) => ({
  pinsBySession: {},

  loadPins: (sessionId, pins) =>
    set((s) => ({ pinsBySession: { ...s.pinsBySession, [sessionId]: pins } })),

  addPin: (sessionId, content) => {
    const pin: Pin = {
      id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      content,
      title: makeTitle(content),
      x: -1,
      y: -1,
      createdAt: Date.now(),
    };
    set((s) => ({
      pinsBySession: { ...s.pinsBySession, [sessionId]: [...(s.pinsBySession[sessionId] || []), pin] },
    }));
    get().persistPins(sessionId);
  },

  removePin: (sessionId, pinId) => {
    set((s) => ({
      pinsBySession: {
        ...s.pinsBySession,
        [sessionId]: (s.pinsBySession[sessionId] || []).filter((p) => p.id !== pinId),
      },
    }));
    get().persistPins(sessionId);
  },

  movePin: (sessionId, pinId, x, y) =>
    set((s) => ({
      pinsBySession: {
        ...s.pinsBySession,
        [sessionId]: (s.pinsBySession[sessionId] || []).map((p) =>
          p.id === pinId ? { ...p, x, y } : p
        ),
      },
    })),

  resizePin: (sessionId, pinId, width, height) =>
    set((s) => ({
      pinsBySession: {
        ...s.pinsBySession,
        [sessionId]: (s.pinsBySession[sessionId] || []).map((p) =>
          p.id === pinId ? { ...p, width, height } : p
        ),
      },
    })),

  bringToFront: (sessionId, pinId) => {
    set((s) => {
      const pins = s.pinsBySession[sessionId] || [];
      const pin = pins.find((p) => p.id === pinId);
      if (!pin) return {};
      return {
        pinsBySession: { ...s.pinsBySession, [sessionId]: [...pins.filter((p) => p.id !== pinId), pin] },
      };
    });
    get().persistPins(sessionId);
  },

  migrateSession: (oldSid, newSid) => {
    if (oldSid === newSid) return;
    const old = get().pinsBySession[oldSid];
    if (!old || old.length === 0) return;
    set((s) => {
      const next = { ...s.pinsBySession };
      next[newSid] = [...(next[newSid] || []), ...old];
      delete next[oldSid];
      return { pinsBySession: next };
    });
    get().persistPins(newSid);
  },

  persistPins: (sessionId) => {
    // vitest 为 node 环境（window 未声明）；浏览器中 electronAPI 可能不存在（dev server），可选链容错
    if (typeof window !== "undefined") {
      window.electronAPI?.pin?.set(sessionId, get().pinsBySession[sessionId] || [])
        .catch((e: unknown) => console.error("[pin-store] 持久化失败", e));
    }
  },
}));
