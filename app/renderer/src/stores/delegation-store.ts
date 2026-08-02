import { create } from "zustand";

/** 输入卡片内的后台指示器(agent 胶囊 / shell 胶囊) */
export type IndicatorKey = "agent" | "shell";

/** 后台进程计数(输入卡片显示):agent·N / shell·N */
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
  /** 活跃顺序:谁先出现谁在左,后出现的自动排右边(消失时移除) */
  order: IndicatorKey[];
  setAgentTasks: (tasks: RunningTaskInfo[]) => void;
  setShellCount: (n: number) => void;
  reset: () => void;
}

/** 维护活跃顺序:变为活跃时追加,变为空闲时移除 */
function updateOrder(order: IndicatorKey[], key: IndicatorKey, active: boolean): IndicatorKey[] {
  if (active) return order.includes(key) ? order : [...order, key];
  return order.filter((k) => k !== key);
}

export const useDelegationStore = create<DelegationState>((set) => ({
  agentTasks: [],
  shellCount: 0,
  order: [],
  setAgentTasks: (tasks) =>
    set((s) => ({
      agentTasks: tasks,
      order: updateOrder(s.order, "agent", tasks.length > 0),
    })),
  setShellCount: (n) =>
    set((s) => ({
      shellCount: n,
      order: updateOrder(s.order, "shell", n > 0),
    })),
  reset: () => set({ agentTasks: [], shellCount: 0, order: [] }),
}));
