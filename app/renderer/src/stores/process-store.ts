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

interface CmdState {
  running: boolean;
  pid?: number;
  logs: string[];
}

interface ProcessState {
  runnables: Runnable[];
  cmdStates: Record<string, CmdState>; // key = commandId
  activeLogId: string | null;          // 当前打开的日志 Overlay 对应的 commandId
  detect: (projectPath: string) => Promise<void>;
  start: (projectPath: string, commandId: string, port?: number) => Promise<void>;
  stop: (commandId: string) => Promise<void>;
  restart: (projectPath: string, commandId: string) => Promise<void>;
  loadStatus: (commandId: string) => Promise<void>;
  appendLog: (commandId: string, line: string) => void;
  setRunning: (commandId: string, running: boolean) => void;
  openLog: (commandId: string) => void;
  closeLog: () => void;
}

const MAX_LOG = 500;

export const useProcessStore = create<ProcessState>((set, get) => ({
  runnables: [],
  cmdStates: {},
  activeLogId: null,

  detect: async (projectPath) => {
    if (!projectPath) { set({ runnables: [] }); return; }
    try {
      const runnables = (await window.electronAPI.process.detect(projectPath)) as Runnable[];
      set({ runnables });
      // 同步所有命令的运行状态
      const ids = await window.electronAPI.process.runningIds();
      const cmdStates: Record<string, CmdState> = {};
      for (const r of runnables) {
        const running = ids.includes(r.id);
        if (running) {
          const s = await window.electronAPI.process.status(r.id);
          cmdStates[r.id] = { running: true, pid: s.pid, logs: s.output };
        } else {
          cmdStates[r.id] = { running: false, logs: [] };
        }
      }
      set({ cmdStates });
    } catch { /* ignore */ }
  },

  start: async (projectPath, commandId, port) => {
    await window.electronAPI.process.start(projectPath, commandId, port);
    set((s) => ({
      cmdStates: { ...s.cmdStates, [commandId]: { running: true, logs: [] } },
      activeLogId: commandId,
    }));
    // 拉取真实 pid:start 只置 running,主进程 status 含 proc.pid——
    // 不拉则运行面板 PID 显示 undefined(字母而非进程 id)
    await get().loadStatus(commandId);
  },

  stop: async (commandId) => {
    await window.electronAPI.process.stop(commandId);
    set((s) => ({
      cmdStates: { ...s.cmdStates, [commandId]: { running: false, logs: [] } },
    }));
  },

  restart: async (projectPath, commandId) => {
    await window.electronAPI.process.restart(projectPath, commandId);
    set((s) => ({
      cmdStates: { ...s.cmdStates, [commandId]: { running: true, logs: [] } },
    }));
    // 同 start:补拉真实 pid
    await get().loadStatus(commandId);
  },

  loadStatus: async (commandId) => {
    try {
      const st = await window.electronAPI.process.status(commandId);
      set((s) => {
        const cur = s.cmdStates[commandId] || { running: false, logs: [] };
        // 主进程返回空输出(进程已退出,内存 map 已删)→ 保留前端已有日志,不覆盖成空
        return { cmdStates: { ...s.cmdStates, [commandId]: { running: st.running, pid: st.pid, logs: st.output.length > 0 ? st.output : cur.logs } } };
      });
    } catch { /* ignore */ }
  },

  appendLog: (commandId, line) => set((s) => {
    const cur = s.cmdStates[commandId] || { running: false, logs: [] };
    const logs = [...cur.logs, line];
    if (logs.length > MAX_LOG) logs.splice(0, logs.length - MAX_LOG);
    return { cmdStates: { ...s.cmdStates, [commandId]: { ...cur, logs } } };
  }),

  setRunning: (commandId, running) => set((s) => {
    const cur = s.cmdStates[commandId] || { running: false, logs: [] };
    if (!running) {
      // 进程退出，日志保留（用户还能看），但状态变 false
      return { cmdStates: { ...s.cmdStates, [commandId]: { ...cur, running: false, pid: undefined } } };
    }
    return { cmdStates: { ...s.cmdStates, [commandId]: { ...cur, running: true } } };
  }),

  openLog: (commandId) => set({ activeLogId: commandId }),
  closeLog: () => set({ activeLogId: null }),
}));
