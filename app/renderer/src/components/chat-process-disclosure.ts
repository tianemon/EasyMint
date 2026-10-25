import { create } from "zustand";

/** Renderer memory only: switching tabs retains intent; restarting restores defaults. */
export const useProcessDisclosure = create<{
  expanded: Record<string, boolean>;
  toggle: (key: string) => void;
  close: (key: string) => void;
}>((set) => ({
  expanded: {},
  close: (key) => set(state => {
    if (!state.expanded[key]) return state;
    const expanded = { ...state.expanded };
    delete expanded[key];
    return { expanded };
  }),
  toggle: (key) => set(state => {
    const expanded = { ...state.expanded };
    if (expanded[key]) delete expanded[key];
    else {
      expanded[key] = true;
      const keys = Object.keys(expanded);
      if (keys.length > 300) delete expanded[keys[0]!];
    }
    return { expanded };
  }),
}));
