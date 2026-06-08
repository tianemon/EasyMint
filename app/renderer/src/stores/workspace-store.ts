import { create } from "zustand";

interface WorkspaceState {
  collapsedLeft: boolean;
  collapsedRight: boolean;
  /** Stored as ratio (0-1), converted to px on read */
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

/** Convert ratio to pixel width based on current window width */
export function ratioToPx(ratio: number): number {
  return Math.round(ratio * window.innerWidth);
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  collapsedLeft: false,
  collapsedRight: false,
  leftRatio: DEFAULT_LEFT_RATIO,
  rightRatio: DEFAULT_RIGHT_RATIO,

  toggleLeft: () =>
    set((s) => ({ collapsedLeft: !s.collapsedLeft })),
  toggleRight: () =>
    set((s) => ({ collapsedRight: !s.collapsedRight })),
  setLeftRatio: (r) =>
    set({ leftRatio: Math.max(MIN_RATIO, Math.min(r, MAX_LEFT_RATIO)) }),
  setRightRatio: (r) =>
    set({ rightRatio: Math.max(MIN_RATIO, Math.min(r, MAX_RIGHT_RATIO)) }),
}));
