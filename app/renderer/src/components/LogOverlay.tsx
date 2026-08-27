import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  // 自动贴底跟随:用户滚离底部(dist>8)停止,回底按钮恢复
  const autoScrollRef = useRef(true);
  const lastUserInputRef = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  // 用户输入(wheel/touch/mousedown)标记——500ms 内的 scroll 变化视为用户滚动意图
  const markUserInput = (): void => { lastUserInputRef.current = Date.now(); };
  const handleUserInput = (): void => markUserInput();
  const handleScroll = (): void => {
    if (Date.now() - lastUserInputRef.current > 500) return;
    const el = logRef.current; if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 8;
    autoScrollRef.current = atBottom;
    setAwayFromBottom(!atBottom);
  };
  const scrollToBottom = (): void => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    autoScrollRef.current = true;
    setAwayFromBottom(false);
  };

  // 自动滚底(仅自动跟随态——用户滚动时可自由查看历史)
  useEffect(() => {
    if (!autoScrollRef.current) return;
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  if (!runnable) return <></>;

  // createPortal 挂 body:抽屉容器(sb-drawer)常驻 transform,会劫持 fixed 定位
  // (fixed 相对 transform 祖先而非视口)——弹窗会被限制在抽屉内,必须脱离
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40" onClick={closeLog}>
      <div className="relative bg-surface rounded-xl border border-border shadow-2xl w-[80vw] h-[80vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header：label 截断占主空间，其余元素 shrink-0 防挤压换行竖排 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface-alt shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-soft text-accent font-mono shrink-0">[{PLATFORM_LABEL[runnable.platform as RunPlatform] || runnable.platform}]</span>
          <span className="text-sm text-text-primary font-medium truncate min-w-0 flex-1">{runnable.label}</span>
          <span className="text-[10px] text-text-muted font-mono truncate min-w-0 max-w-[25%] shrink-0">{runnable.run_command}</span>
          {state?.running ? (
            <span className="text-[10px] text-success flex items-center gap-1 ml-2 shrink-0 whitespace-nowrap"><span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />运行中</span>
          ) : (
            <span className="text-[10px] text-text-muted ml-2 shrink-0 whitespace-nowrap">已停止</span>
          )}
          {state?.running && (
            <button
              className="px-2.5 py-1 rounded-lg bg-danger-soft text-danger text-xs hover:bg-danger-bg transition-colors shrink-0 whitespace-nowrap"
              onClick={() => stop(commandId)}
            >停止运行</button>
          )}
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors shrink-0"
            onClick={closeLog}
            title="关闭（不停止运行）"
          >✕</button>
        </div>

        {/* 日志区(可选中复制) */}
        <div ref={logRef} onScroll={handleScroll} onWheel={handleUserInput} onTouchStart={handleUserInput} onMouseDown={handleUserInput} className="log-overlay-output flex-1 min-h-0 overflow-y-auto bg-[#1e1e1e] p-3 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? (
            <span className="text-[#888]">等待输出...</span>
          ) : (
            logs.map((line, i) => (
              <div key={i} className="text-[#d4d4d4] whitespace-pre-wrap break-all">{line}</div>
            ))
          )}
        </div>

        {/* 回底按钮:滚离底部时显示,点击贴底并恢复自动跟随 */}
        {awayFromBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute right-4 bottom-10 w-8 h-8 rounded-full bg-accent text-text-inverse shadow-lg flex items-center justify-center hover:bg-accent-hover transition-colors"
            title="回到底部"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/></svg>
          </button>
        )}

        {/* 底部提示 */}
        <div className="px-4 py-1.5 border-t border-border bg-surface-alt shrink-0">
          <span className="text-[10px] text-text-muted">关闭窗口不会停止运行，点眼睛图标可重新查看</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
