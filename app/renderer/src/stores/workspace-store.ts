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

const DEFAULT_LEFT_WIDTH = 220;
const DEFAULT_RIGHT_WIDTH = 280;
const MIN_PANEL_WIDTH = 140;
const MAX_LEFT_WIDTH = 480;
const MAX_RIGHT_WIDTH = 600;

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  collapsedLeft: false,
  collapsedRight: false,
  leftWidth: DEFAULT_LEFT_WIDTH,
  rightWidth: DEFAULT_RIGHT_WIDTH,

  toggleLeft: () =>
    set((s) => ({ collapsedLeft: !s.collapsedLeft })),
  toggleRight: () =>
    set((s) => ({ collapsedRight: !s.collapsedRight })),
  setLeftWidth: (w) =>
    set({ leftWidth: Math.max(MIN_PANEL_WIDTH, Math.min(w, MAX_LEFT_WIDTH)) }),
  setRightWidth: (w) =>
    set({ rightWidth: Math.max(MIN_PANEL_WIDTH, Math.min(w, MAX_RIGHT_WIDTH)) }),
}));
