import { useEffect } from "react";
import { useProcessStore, type RunPlatform } from "../stores/process-store";
import { LogOverlay } from "./LogOverlay";

interface RunPanelProps {
  projectPath: string;
  onCollapse: () => void;
}

const PLATFORM_LABEL: Record<RunPlatform, string> = {
  react: "react",
  vue: "vue",
  nextjs: "next.js",
  nuxt: "nuxt",
  angular: "angular",
  svelte: "svelte",
  spring: "spring",
  django: "django",
  flask: "flask",
  fastapi: "fastapi",
  nodejs: "node.js",
  rails: "rails",
  laravel: "laravel",
  go: "go",
  rust: "rust",
  dotnet: ".net",
  "react-native": "react native",
  expo: "expo",
  flutter: "flutter",
  electron: "electron",
  tauri: "tauri",
  python: "python",
  shell: "shell",
};

const PLATFORM_COLOR: Record<RunPlatform, string> = {
  react: "bg-sky-500/15 text-sky-500",
  vue: "bg-emerald-500/15 text-emerald-500",
  nextjs: "bg-neutral-500/15 text-neutral-600",
  nuxt: "bg-emerald-500/15 text-emerald-500",
  angular: "bg-red-500/15 text-red-500",
  svelte: "bg-orange-500/15 text-orange-500",
  spring: "bg-green-600/15 text-green-600",
  django: "bg-green-600/15 text-green-600",
  flask: "bg-gray-500/15 text-gray-500",
  fastapi: "bg-teal-500/15 text-teal-500",
  nodejs: "bg-yellow-500/15 text-yellow-600",
  rails: "bg-red-600/15 text-red-600",
  laravel: "bg-red-500/15 text-red-500",
  go: "bg-cyan-500/15 text-cyan-500",
  rust: "bg-orange-600/15 text-orange-600",
  dotnet: "bg-purple-500/15 text-purple-500",
  "react-native": "bg-blue-500/15 text-blue-500",
  expo: "bg-purple-500/15 text-purple-500",
  flutter: "bg-blue-400/15 text-blue-400",
  electron: "bg-violet-500/15 text-violet-500",
  tauri: "bg-orange-500/15 text-orange-500",
  python: "bg-blue-500/15 text-blue-500",
  shell: "bg-gray-500/15 text-gray-500",
};

function platformLabel(p: string): string {
  return PLATFORM_LABEL[p as RunPlatform] || p;
}

const DEFAULT_COLOR = "bg-gray-400/15 text-gray-400";

function platformColor(p: string): string {
  return PLATFORM_COLOR[p as RunPlatform] || DEFAULT_COLOR;
}

export function RunPanel({ projectPath, onCollapse }: RunPanelProps): JSX.Element {
  const { runnables, cmdStates, activeLogId, detect, start, stop, restart, openLog, appendLog, setRunning, loadStatus } = useProcessStore();

  useEffect(() => {
    detect(projectPath);
  }, [projectPath, detect]);

  // 监听进程输出
  useEffect(() => {
    const off = window.electronAPI?.process?.onOutput?.((data) => {
      appendLog(data.commandId, data.line);
    });
    return () => { off?.(); };
  }, [appendLog]);

  // 监听状态变更（进程退出立即更新）
  useEffect(() => {
    const off = window.electronAPI?.process?.onStatusChanged?.((data) => {
      setRunning(data.commandId, data.running);
      if (!data.running) loadStatus(data.commandId); // 拉一次确保同步
    });
    return () => { off?.(); };
  }, [setRunning, loadStatus]);

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center gap-2 h-9 px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">运行</span>
        <div className="flex-1" />
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-accent hover:bg-surface-hover transition-colors"
          onClick={() => detect(projectPath)}
          title="刷新检测"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
          onClick={onCollapse}
          title="收起面板"
        >
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M4.5 3l3 3-3 3" /></svg>
        </button>
      </div>

      {/* 命令列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
        {runnables.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px] text-text-muted text-center px-4">
            未检测到启动配置<br />Mint 开发完会生成 .easymint/run.json
          </div>
        ) : (
          <div className="space-y-1.5">
            {runnables.map((r) => {
              const st = cmdStates[r.id] || { running: false, logs: [] };
              return (
                <div key={r.id} className={`rounded-lg border px-2.5 py-2 transition-colors ${st.running ? "border-success-border bg-success-soft" : "border-border"}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${platformColor(r.platform)}`}>[{platformLabel(r.platform)}]</span>
                    <span className="text-xs text-text-primary font-medium truncate flex-1">{r.label}</span>
                    {st.running && (
                      <span className="text-[9px] text-success flex items-center gap-1 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                        PID {st.pid}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-text-muted font-mono mt-0.5 truncate">{r.run_command}</p>

                  <div className="flex items-center gap-1 mt-1.5">
                    {st.running ? (
                      <>
                        <button
                          className="flex-1 px-2 py-1 rounded bg-danger-soft text-danger text-[10px] font-medium hover:bg-danger-bg transition-colors"
                          onClick={() => stop(r.id)}
                        >停止</button>
                        <button
                          className="flex-1 px-2 py-1 rounded border border-border text-text-secondary text-[10px] hover:border-accent-border-strong transition-colors"
                          onClick={() => restart(projectPath, r.id)}
                        >重启</button>
                        <button
                          className="w-7 h-7 flex items-center justify-center rounded border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors"
                          onClick={() => openLog(r.id)}
                          title="查看日志"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                      </>
                    ) : (
                      <button
                        className="flex-1 px-2 py-1 rounded bg-accent-soft text-accent text-[10px] font-medium hover:bg-accent-bg transition-colors"
                        onClick={() => start(projectPath, r.id)}
                      >启动</button>
                    )}
                    {st.running && r.url && (
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded border border-border text-text-secondary hover:text-accent hover:border-accent-border-strong transition-colors ml-1"
                        onClick={() => window.open(r.url, "_blank")}
                        title={`打开 ${r.url}`}
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 日志浮窗 */}
      {activeLogId && <LogOverlay commandId={activeLogId} />}
    </div>
  );
}
