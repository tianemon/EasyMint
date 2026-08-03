import { create } from "zustand";

/** 输入卡片内的后台指示器(agent 胶囊 / shell 胶囊) */
export type IndicatorKey = "agent" | "shell";

/** 运行中的子 Agent 任务(点击展开显示,可单个停止) */
export interface RunningTaskInfo {
  delegationId: string;
  index: number;
  title: string;
  /** 子会话 jsonl 路径(查看 Agent 过程弹层定位;由委派进度 progress.sessionFile 透传) */
  sessionFile?: string;
}

/** 运行中的后台 shell 命令(点击展开显示,可单个停止) */
export interface ShellTaskInfo {
  id: string;
  command: string;
  startedAt: number;
  /** 运行状态:stopping = 已点停止、杀进程中(前端显示「停止中…」) */
  status: "running" | "stopping";
  /** 完整输出日志文件路径(查看输出弹层定位) */
  logPath: string;
}

interface DelegationState {
  /** 运行中的子 Agent 任务列表 */
  agentTasks: RunningTaskInfo[];
  /** 后台 shell 命令列表(主进程 agent:shell-count 广播驱动) */
  shellTasks: ShellTaskInfo[];
  /** delegationId:index → 子会话 jsonl 路径(委派进度回填,查看 Agent 过程弹层定位) */
  sessionFiles: Record<string, string>;
  /** taskId → 委派实时执行状态(TaskPanel 行实时视图;终态移除) */
  taskExecutions: Record<string, { status: string; durationMs: number }>;
  /** 活跃顺序:谁先出现谁在左,后出现的自动排右边(消失时移除) */
  order: IndicatorKey[];
  setAgentTasks: (tasks: RunningTaskInfo[]) => void;
  setShellTasks: (tasks: ShellTaskInfo[]) => void;
  setSessionFile: (delegationId: string, index: number, sessionFile: string) => void;
  setTaskExecution: (taskId: string, exec: { status: string; durationMs: number }) => void;
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
  sessionFiles: {},
  taskExecutions: {},
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
  setSessionFile: (delegationId, index, sessionFile) =>
    set((s) => ({ sessionFiles: { ...s.sessionFiles, [`${delegationId}:${index}`]: sessionFile } })),
  setTaskExecution: (taskId, exec) =>
    set((s) => {
      const next = { ...s.taskExecutions };
      if (exec.status === "running") {
        next[taskId] = exec;
      } else {
        delete next[taskId]; // 终态:task.json 已回写,由刷新驱动显示
      }
      return { taskExecutions: next };
    }),
  reset: () => set({ agentTasks: [], shellTasks: [], sessionFiles: {}, taskExecutions: {}, order: [] }),
}));
