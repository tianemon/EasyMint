import { create } from "zustand";

/** 输入卡片内的后台指示器(agent 胶囊 / shell 胶囊) */
export type IndicatorKey = "agent" | "shell";

/** 运行中的子 Agent 任务(点击展开显示,可单个停止) */
export interface RunningTaskInfo {
  delegationId: string;
  index: number;
  title: string;
}

/** 运行中的后台 shell 命令(点击展开显示,可单个停止) */
export interface ShellTaskInfo {
  id: string;
  command: string;
  startedAt: number;
}

interface DelegationState {
  /** 运行中的子 Agent 任务列表 */
  agentTasks: RunningTaskInfo[];
  /** 后台 shell 命令列表(主进程 agent:shell-count 广播驱动) */
  shellTasks: ShellTaskInfo[];
  /** 活跃顺序:谁先出现谁在左,后出现的自动排右边(消失时移除) */
  order: IndicatorKey[];
  setAgentTasks: (tasks: RunningTaskInfo[]) => void;
  setShellTasks: (tasks: ShellTaskInfo[]) => void;
  reset: () => void;
}

/** 维护活跃顺序:变为活跃时追加,变为空闲时移除 */
function updateOrder(order: IndicatorKey[], key: IndicatorKey, active: boolean): IndicatorKey[] {
  if (active) return order.includes(key) ? order : [...order, key];
  return order.filter((k) => k !== key);
}

export const useDelegationStore = create<DelegationState>((set) => ({
  agentTasks: [],
  shellTasks: [],
  order: [],
  setAgentTasks: (tasks) =>
    set((s) => ({
      agentTasks: tasks,
      order: updateOrder(s.order, "agent", tasks.length > 0),
    })),
  setShellTasks: (tasks) =>
    set((s) => ({
      shellTasks: tasks,
      order: updateOrder(s.order, "shell", tasks.length > 0),
    })),
  reset: () => set({ agentTasks: [], shellTasks: [], order: [] }),
}));
