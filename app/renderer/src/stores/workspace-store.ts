import { create } from "zustand";

interface WorkspaceState {
  collapsedLeft: boolean;
  collapsedRight: boolean;
  leftWidth: number;
  rightWidth: number;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
}

const DEFAULT_LEFT_WIDTH = 260;
const DEFAULT_RIGHT_WIDTH = 280;
const MIN_WIDTH = 120;
const MAX_LEFT_WIDTH = 500;
const MAX_RIGHT_WIDTH = 600;

const STORAGE_KEY = "easymint_panel_widths";

function readStored(): { left: number; right: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v.left === "number" && typeof v.right === "number") {
      return {
        left: Math.max(MIN_WIDTH, Math.min(v.left, MAX_LEFT_WIDTH)),
        right: Math.max(MIN_WIDTH, Math.min(v.right, MAX_RIGHT_WIDTH)),
      };
    }
  } catch { /* ignore */ }
  return null;
}

function persist(width: number, side: "left" | "right"): void {
  try {
    const current = readStored() || { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH };
    current[side] = width;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch { /* ignore */ }
}

const stored = readStored();

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  collapsedLeft: false,
  collapsedRight: false,
  leftWidth: stored?.left ?? DEFAULT_LEFT_WIDTH,
  rightWidth: stored?.right ?? DEFAULT_RIGHT_WIDTH,

  toggleLeft: () => set((s) => ({ collapsedLeft: !s.collapsedLeft })),
  toggleRight: () => set((s) => ({ collapsedRight: !s.collapsedRight })),
  setLeftWidth: (w) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(w, MAX_LEFT_WIDTH));
    persist(clamped, "left");
    set({ leftWidth: clamped });
  },
  setRightWidth: (w) => {
    const clamped = Math.max(MIN_WIDTH, Math.min(w, MAX_RIGHT_WIDTH));
    persist(clamped, "right");
    set({ rightWidth: clamped });
  },
}));
