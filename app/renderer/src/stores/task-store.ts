import { create } from "zustand";

export type TaskStatus = "pending" | "running" | "done" | "failed";

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  /** Shell command to execute (relative to project root) */
  command: string;
  status: TaskStatus;
  output: string[];
  createdAt: number;
}

interface TaskState {
  tasks: TaskItem[];
  addTask: (t: Omit<TaskItem, "output" | "createdAt">) => void;
  updateTask: (id: string, patch: Partial<Pick<TaskItem, "status" | "output">>) => void;
  appendOutput: (id: string, line: string) => void;
  clearTasks: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],

  addTask: (t) => {
    const task: TaskItem = {
      ...t,
      output: [],
      createdAt: Date.now(),
    };
    set((s) => ({ tasks: [...s.tasks, task] }));
  },

  updateTask: (id, patch) => {
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  },

  appendOutput: (id, line) => {
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, output: [...t.output, line] } : t
      ),
    }));
  },

  clearTasks: () => set({ tasks: [] }),
}));
