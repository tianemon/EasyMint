import { useEffect, useRef } from "react";
import { useProcessStore } from "../stores/process-store";
import type { RunPlatform } from "../stores/process-store";

interface LogOverlayProps {
  commandId: string;
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

export function LogOverlay({ commandId }: LogOverlayProps): JSX.Element {
  const { cmdStates, runnables, stop, closeLog } = useProcessStore();
  const logRef = useRef<HTMLDivElement>(null);
  const state = cmdStates[commandId];
  const runnable = runnables.find((r) => r.id === commandId);
  const logs = state?.logs || [];

  // 自动滚底
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  if (!runnable) return <></>;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={closeLog}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl w-[80vw] h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface-alt shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent font-mono">[{PLATFORM_LABEL[runnable.platform as RunPlatform] || runnable.platform}]</span>
          <span className="text-sm text-text-primary font-medium">{runnable.label}</span>
          <span className="text-[10px] text-text-muted font-mono truncate">{runnable.run_command}</span>
          {state?.running ? (
            <span className="text-[10px] text-success flex items-center gap-1 ml-2"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />运行中</span>
          ) : (
            <span className="text-[10px] text-text-muted ml-2">已停止</span>
          )}
          <div className="flex-1" />
          {state?.running && (
            <button
              className="px-2.5 py-1 rounded-lg bg-danger-soft text-danger text-xs hover:bg-danger-bg transition-colors"
              onClick={() => stop(commandId)}
            >停止运行</button>
          )}
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors"
            onClick={closeLog}
            title="关闭（不停止运行）"
          >✕</button>
        </div>

        {/* 日志区 */}
        <div ref={logRef} className="flex-1 min-h-0 overflow-y-auto bg-[#1e1e1e] p-3 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? (
            <span className="text-[#888]">等待输出...</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="text-[#d4d4d4] whitespace-pre-wrap break-all">{line}</div>
            ))
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-4 py-1.5 border-t border-border bg-surface-alt shrink-0">
          <span className="text-[10px] text-text-muted">关闭窗口不会停止运行，点眼睛图标可重新查看</span>
        </div>
      </div>
    </div>
  );
}
