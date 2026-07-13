import { create } from "zustand";

export type IssueStatus = "open" | "fixed";

export interface IssueNote {
  content: string;
  createdAt: number;
}

export interface IssueItem {
  id: string;
  title: string;
  module: string;
  symptom: string;
  notes: IssueNote[];
  status: IssueStatus;
  createdAt: number;
}

interface IssueState {
  issues: IssueItem[];
  load: (projectPath: string) => Promise<void>;
  add: (projectPath: string, title: string, module: string, symptom: string) => Promise<void>;
  setStatus: (projectPath: string, id: string, status: IssueStatus) => Promise<void>;
  appendNote: (projectPath: string, id: string, content: string) => Promise<void>;
  remove: (projectPath: string, id: string) => Promise<void>;
}

export const useIssueStore = create<IssueState>((set, get) => ({
  issues: [],

  load: async (projectPath) => {
    if (!projectPath) { set({ issues: [] }); return; }
    try {
      const issues = await window.electronAPI.issue.list(projectPath);
      set({ issues });
    } catch { /* ignore */ }
  },

  add: async (projectPath, title, module, symptom) => {
    if (!projectPath) return;
    await window.electronAPI.issue.add(projectPath, title, module, symptom);
    await get().load(projectPath);
  },

  setStatus: async (projectPath, id, status) => {
    if (!projectPath) return;
    await window.electronAPI.issue.setStatus(projectPath, id, status);
    await get().load(projectPath);
  },

  appendNote: async (projectPath, id, content) => {
    if (!projectPath) return;
    await window.electronAPI.issue.appendNote(projectPath, id, content);
    await get().load(projectPath);
  },

  remove: async (projectPath, id) => {
    if (!projectPath) return;
    await window.electronAPI.issue.delete(projectPath, id);
    await get().load(projectPath);
  },
}));
