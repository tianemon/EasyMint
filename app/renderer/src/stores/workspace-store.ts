import { create } from "zustand";

interface WorkspaceState {
  collapsedLeft: boolean;
  collapsedRight: boolean;
  leftRatio: number;
  rightRatio: number;
  toggleLeft: () => void;
  toggleRight: () => void;
  setLeftRatio: (r: number) => void;
  setRightRatio: (r: number) => void;
}

const DEFAULT_LEFT_RATIO = 0.18;
const DEFAULT_RIGHT_RATIO = 0.22;
const MIN_RATIO = 0.08;
const MAX_LEFT_RATIO = 0.35;
const MAX_RIGHT_RATIO = 0.45;

const STORAGE_KEY = "easymint_panel_ratios";

function readStored(): { left: number; right: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v.left === "number" && typeof v.right === "number") {
      return { left: Math.max(MIN_RATIO, Math.min(v.left, MAX_LEFT_RATIO)),
               right: Math.max(MIN_RATIO, Math.min(v.right, MAX_RIGHT_RATIO)) };
    }
  } catch { /* ignore */ }
  return null;
}

function persist(ratio: number, side: "left" | "right"): void {
  try {
    const current = readStored() || { left: DEFAULT_LEFT_RATIO, right: DEFAULT_RIGHT_RATIO };
    current[side] = ratio;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch { /* ignore */ }
}

const stored = readStored();

/** Convert ratio to pixel width based on current window width */
export function ratioToPx(ratio: number): number {
  return Math.round(ratio * window.innerWidth);
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  collapsedLeft: false,
  collapsedRight: false,
  leftRatio: stored?.left ?? DEFAULT_LEFT_RATIO,
  rightRatio: stored?.right ?? DEFAULT_RIGHT_RATIO,

  toggleLeft: () =>
    set((s) => ({ collapsedLeft: !s.collapsedLeft })),
  toggleRight: () =>
    set((s) => ({ collapsedRight: !s.collapsedRight })),
  setLeftRatio: (r) => {
    const clamped = Math.max(MIN_RATIO, Math.min(r, MAX_LEFT_RATIO));
    persist(clamped, "left");
    set({ leftRatio: clamped });
  },
  setRightRatio: (r) => {
    const clamped = Math.max(MIN_RATIO, Math.min(r, MAX_RIGHT_RATIO));
    persist(clamped, "right");
    set({ rightRatio: clamped });
  },
}));
