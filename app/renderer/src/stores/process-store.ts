import { create } from "zustand";

export type RunPlatform =
  | "react" | "vue" | "nextjs" | "nuxt" | "angular" | "svelte"
  | "spring" | "django" | "flask" | "fastapi" | "nodejs" | "rails" | "laravel" | "go" | "rust" | "dotnet" | "git" | "java"
  | "react-native" | "expo" | "flutter"
  | "electron" | "tauri"
  | "python" | "shell";

export interface Runnable {
  id: string;
  platform: string;
  label: string;
  run_command: string;
  cwd?: string;
  install_command?: string;
  url?: string;
}

/** 单条日志行：id 为单调追加序号（头部裁剪 >500 行后仍稳定，作 React key 防行位移），text 为原始行文本 */
export interface LogLine {
  id: number;
  text: string;
}

interface CmdState {
  running: boolean;
  pid?: number;
  /** 服务就绪（有 url 配置时由主进程 HTTP 探测广播） */
  ready?: boolean;
}

interface ProcessState {
  runnables: Runnable[];
  cmdStates: Record<string, CmdState>; // key = commandId
  /** 运行日志按 commandId 独立存放（高频 append 只换本条数组，不扰动只关心状态的订阅者） */
  logLines: Record<string, LogLine[]>; // key = commandId
  activeLogId: string | null;          // 当前打开的日志 Overlay 对应的 commandId
  detect: (projectPath: string) => Promise<void>;
  start: (projectPath: string, commandId: string, port?: number) => Promise<void>;
  stop: (commandId: string) => Promise<void>;
  restart: (projectPath: string, commandId: string) => Promise<void>;
  loadStatus: (commandId: string) => Promise<void>;
  appendLog: (commandId: string, line: string) => void;
  setRunning: (commandId: string, running: boolean, ready?: boolean) => void;
  openLog: (commandId: string) => void;
  closeLog: () => void;
}

const MAX_LOG = 500;

/** 日志行全局单调序号：头部裁剪后剩余行 id 不变，日志窗口不因 key={i} 位移而全量重挂载 */
let lineSeq = 0;

/** 字符串行 → 带稳定 id 的日志行 */
function toLogLines(rows: string[]): LogLine[] {
  return rows.map((text) => ({ id: ++lineSeq, text }));
}

/** 追加一行并裁头（保留末尾 MAX_LOG 行） */
function appendLine(cur: LogLine[], line: string): LogLine[] {
  const next = [...cur, { id: ++lineSeq, text: line }];
  return next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next;
}

export const useProcessStore = create<ProcessState>((set, get) => ({
  runnables: [],
  cmdStates: {},
  logLines: {},
  activeLogId: null,

  detect: async (projectPath) => {
    if (!projectPath) { set({ runnables: [], cmdStates: {}, logLines: {} }); return; }
    try {
      const runnables = (await window.electronAPI.process.detect(projectPath)) as Runnable[];
      set({ runnables });
      // 同步所有命令的运行状态——以 status 拉取结果为准（单一真相源），
      // 不用 runningIds 预判后硬编码 true，避免列表与拉取之间的竞态误报
      const cmdStates: Record<string, CmdState> = {};
      const logLines: Record<string, LogLine[]> = {};
      for (const r of runnables) {
        const s = await window.electronAPI.process.status(r.id);
        if (s.running) {
          cmdStates[r.id] = { running: true, pid: s.pid };
          logLines[r.id] = toLogLines(s.output);
        } else {
          cmdStates[r.id] = { running: false };
        }
      }
      set({ cmdStates, logLines });
    } catch { /* ignore */ }
  },

  start: async (projectPath, commandId, port) => {
    await window.electronAPI.process.start(projectPath, commandId, port);
    set((s) => ({
      cmdStates: { ...s.cmdStates, [commandId]: { running: true } },
      logLines: { ...s.logLines, [commandId]: [] },
      activeLogId: commandId,
    }));
    // 拉取真实 pid:start 只置 running,主进程 status 含 proc.pid——
    // 不拉则运行面板 PID 显示 undefined(字母而非进程 id)
    await get().loadStatus(commandId);
  },

  stop: async (commandId) => {
    await window.electronAPI.process.stop(commandId);
    set((s) => ({
      cmdStates: { ...s.cmdStates, [commandId]: { running: false } },
      logLines: { ...s.logLines, [commandId]: [] },
    }));
  },

  restart: async (projectPath, commandId) => {
    await window.electronAPI.process.restart(projectPath, commandId);
    set((s) => ({
      cmdStates: { ...s.cmdStates, [commandId]: { running: true } },
      logLines: { ...s.logLines, [commandId]: [] },
    }));
    // 同 start:补拉真实 pid
    await get().loadStatus(commandId);
  },

  loadStatus: async (commandId) => {
    try {
      const st = await window.electronAPI.process.status(commandId);
      set((s) => {
        // 主进程返回空输出(进程已退出,内存 map 已删)→ 保留前端已有日志,不覆盖成空
        const logs = st.output.length > 0 ? toLogLines(st.output) : (s.logLines[commandId] || []);
        return {
          cmdStates: { ...s.cmdStates, [commandId]: { running: st.running, pid: st.pid, ready: st.ready } },
          logLines: { ...s.logLines, [commandId]: logs },
        };
      });
    } catch { /* ignore */ }
  },

  appendLog: (commandId, line) => set((s) => ({
    logLines: { ...s.logLines, [commandId]: appendLine(s.logLines[commandId] || [], line) },
  })),

  setRunning: (commandId, running, ready) => set((s) => {
    const cur = s.cmdStates[commandId] || { running: false };
    if (!running) {
      // 进程退出，日志保留（用户还能看），但状态变 false
      return { cmdStates: { ...s.cmdStates, [commandId]: { ...cur, running: false, pid: undefined, ready: undefined } } };
    }
    return { cmdStates: { ...s.cmdStates, [commandId]: { ...cur, running: true, ready } } };
  }),

  openLog: (commandId) => set({ activeLogId: commandId }),
  closeLog: () => set({ activeLogId: null }),
}));
