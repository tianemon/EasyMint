import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ansiToHtml } from "../lib/ansi-colors";
import { registerOverlay } from "../lib/overlay-stack";

/**
 * 统一输出窗口 — 运行日志 / 后台 shell 共用（此前两套独立窗口，维护双份）。
 * 功能并集：自动滚动/回底、Cmd+A 只全选窗口内容、遮罩按下+松开双判断关闭、ANSI 彩色渲染；
 * 头部按数据渲染：停止按钮(onStop)、日志路径跳转(logPath)、截断提示(truncated)。
 * 数据模式二选一：logs（逐行数组，运行日志）或 content（整块字符串，后台 shell）。
 */

interface OutputWindowProps {
  /** 命令文本（头部显示；label 存在时降为次要） */
  command: string;
  /** 友好名称（运行日志的 label；后台 shell 无则显示 command） */
  label?: string;
  /** 运行中状态（头部 spinner + 状态文字） */
  running: boolean;
  /** 逐行日志模式（运行日志） */
  logs?: string[];
  /** 整块内容模式（后台 shell） */
  content?: string;
  /** 提供则显示「停止」按钮（运行日志可停止进程） */
  onStop?: () => void;
  /** 提供则显示日志文件路径（点击在文件夹中显示） */
  logPath?: string;
  /** 内容被截断提示 */
  truncated?: boolean;
  onClose: () => void;
}

export function OutputWindow({ command, label, running, logs, content, onStop, logPath, truncated, onClose }: OutputWindowProps): JSX.Element {
  const outputRef = useRef<HTMLDivElement>(null);
  // 自动贴底跟随:用户滚离底部(dist>8)停止,回底按钮恢复
  const autoScrollRef = useRef(true);
  const lastUserInputRef = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  // 遮罩关闭双判断:按下是否落在遮罩本身(拖拽选中移出边缘松开不误关)
  const overlayDownRef = useRef(false);
  // 注册到全局弹窗栈:点击本窗口不关闭下层(如侧边栏抽屉)
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => registerOverlay(overlayRef.current), []);

  const markUserInput = (): void => { lastUserInputRef.current = Date.now(); };
  const handleUserInput = (): void => markUserInput();
  const handleScroll = (): void => {
    if (Date.now() - lastUserInputRef.current > 500) return;
    const el = outputRef.current; if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 8;
    autoScrollRef.current = atBottom;
    setAwayFromBottom(!atBottom);
  };
  const scrollToBottom = (): void => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    autoScrollRef.current = true;
    setAwayFromBottom(false);
  };

  // 自动滚底(仅自动跟随态)
  useEffect(() => {
    if (!autoScrollRef.current) return;
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [logs, content]);

  // Ctrl+A 接管:焦点或选择锚点在窗口内时只全选输出区。聊天页有 document 级全局 Ctrl+A
  // 拦截(只认消息气泡),焦点在窗口外时事件到不了窗口 div 的 onKeyDown,输出区无法全选;
  // 此处按「焦点/锚点是否在 .output-window 内」判定归属,窗口内接管、窗口外让位聊天逻辑
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "a") return;
      const target = e.target as Element | null;
      const sel = window.getSelection();
      const anchor = sel && sel.rangeCount > 0 ? sel.anchorNode : null;
      const anchorEl = anchor ? (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element)) : null;
      const inWindow = (target && target.closest(".output-window")) || (anchorEl && anchorEl.closest(".output-window"));
      if (!inWindow) return;
      e.preventDefault();
      const el = outputRef.current;
      if (!el) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return createPortal(
    // 遮罩关闭:仅当按下与松开都在遮罩(非窗口内容)才关闭——拖拽选中移出边缘松开不误关
    // (React onClick 的公共祖先语义:mousedown 在窗口内、mouseup 在遮罩,click 会在遮罩触发)
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
      onMouseDown={(e) => { overlayDownRef.current = e.target === e.currentTarget; }}
      onMouseUp={(e) => { if (overlayDownRef.current && e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="output-window relative flex flex-col w-[80vw] h-[80vh] rounded-[12px] border border-border bg-surface-elevated shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        // Cmd/Ctrl+A 只全选输出区内容(不选整个页面)
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
            e.preventDefault(); e.stopPropagation();
            const el = outputRef.current;
            if (!el) return;
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(el);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }}
      >
        {/* 头部:命令 + 状态 + 停止(onStop) + 日志路径(logPath) + 关闭 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface-alt shrink-0">
          {running && (
            <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          <span className="text-sm font-medium text-text-primary truncate flex-1" title={label || command}>{label || command}</span>
          {label && (
            <span className="text-[10px] text-text-muted font-mono truncate min-w-0 max-w-[25%] shrink-0">{command}</span>
          )}
          {logPath && (
            <button
              type="button"
              onClick={() => window.electronAPI.shell.revealInFolder(logPath)}
              className="shrink-0 flex items-center gap-1 max-w-[220px] text-[10px] font-mono text-text-muted hover:text-accent transition-colors"
              title={`在文件夹中显示: ${logPath}`}
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
              <span className="truncate">{logPath}</span>
            </button>
          )}
          <span className="text-[11px] text-text-secondary shrink-0">
            {running ? "运行中" : "已结束"}
          </span>
          {onStop && running && (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 px-2.5 py-1 rounded-lg bg-danger-soft text-danger text-xs hover:bg-danger-bg transition-colors whitespace-nowrap"
            >停止运行</button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
            title="关闭"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* 输出区(可选中复制;ANSI 转彩色渲染;自动换行) */}
        <div
          ref={outputRef}
          onScroll={handleScroll}
          onWheel={handleUserInput}
          onTouchStart={handleUserInput}
          onMouseDown={handleUserInput}
          className="shell-output flex-1 min-h-0 overflow-y-auto px-4 py-3 bg-[var(--color-sidebar)]/40 font-mono text-xs leading-relaxed"
        >
          {truncated && (
            <div className="text-[11px] text-warning mb-2 break-all">
              日志较大,仅显示最近输出(完整: {logPath})
            </div>
          )}
          {logs ? (
            logs.length === 0 ? (
              <span className="text-xs text-text-secondary">等待输出...</span>
            ) : (
              logs.map((line, i) => (
                <div key={i} className="text-text-primary whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
              ))
            )
          ) : content ? (
            <pre className="whitespace-pre-wrap break-words text-text-primary leading-relaxed" dangerouslySetInnerHTML={{ __html: ansiToHtml(content) }} />
          ) : (
            <span className="text-xs text-text-secondary">{running ? "等待输出…" : "(无输出)"}</span>
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
      </div>
    </div>,
    document.body,
  );
}
