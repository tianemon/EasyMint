import { create } from "zustand";

/** 后台进程计数(ProcessBar 显示):agent·N / shell·N */
export interface RunningTaskInfo {
  delegationId: string;
  index: number;
  title: string;
}

interface DelegationState {
  /** 运行中的子 Agent 任务列表(点击展开显示,可单个停止) */
  agentTasks: RunningTaskInfo[];
  /** 主会话正在执行的工具数(shell 等) */
  shellCount: number;
  setAgentTasks: (tasks: RunningTaskInfo[]) => void;
  setShellCount: (n: number) => void;
  reset: () => void;
}

export const useDelegationStore = create<DelegationState>((set) => ({
  agentTasks: [],
  shellCount: 0,
  setAgentTasks: (tasks) => set({ agentTasks: tasks }),
  setShellCount: (n) => set({ shellCount: n }),
  reset: () => set({ agentTasks: [], shellCount: 0 }),
}));
