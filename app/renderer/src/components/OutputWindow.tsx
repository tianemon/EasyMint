import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ansiToHtml } from "../lib/ansi-colors";
import type { LogLine } from "../stores/process-store";
import { Modal } from "./ui/Modal";

/**
 * 单行日志 — memo + 稳定 key：store 追加只改数组引用、已存行对象不变，
 * memo 浅比较命中跳过重渲染 → ansiToHtml 每行只算一次；
 * 头部裁剪(>500 行)只卸载裁掉的行，其余行 key(id)不变不位移不重算
 */
const LogRow = memo(function LogRow({ line }: { line: LogLine }): JSX.Element {
  const html = useMemo(() => ansiToHtml(line.text), [line]);
  return <div className="text-text-primary whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: html }} />;
});

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
  /** 逐行日志模式（运行日志——元素为带稳定 id 的日志行） */
  logs?: LogLine[];
  /** 整块内容模式（后台 shell） */
  content?: string;
  /** 提供则显示「停止」按钮（运行日志可停止进程） */
  onStop?: () => void;
  /** 提供则显示日志文件路径（点击在文件夹中显示） */
  logPath?: string;
  /** 内容被截断提示 */
  truncated?: boolean;
  /** 底部附加区（如「让 Mint 修复」按钮——共用组件向后兼容的可选扩展） */
  footer?: ReactNode;
  onClose: () => void;
}

export function OutputWindow({ command, label, running, logs, content, onStop, logPath, truncated, footer, onClose }: OutputWindowProps): JSX.Element {
  const outputRef = useRef<HTMLDivElement>(null);
  // 自动贴底跟随:用户滚离底部(dist>8)停止,回底按钮恢复
  const autoScrollRef = useRef(true);
  const lastUserInputRef = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

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

  // Modal 的遮罩关闭为 press-release 模式(按下+松开都在遮罩才算),复用原有双判断语义:
  // 拖拽选中日志移出边缘松开不误关。Modal 内部自行 portal + 注册弹窗栈。
  return (
    <Modal
      overlayClose="press-release"
      overlayClassName="bg-black/40"
      onClose={onClose}
    >
      <div
        className="output-window relative flex flex-col w-[80vw] h-[80vh] rounded-[var(--radius-lg)] border border-border bg-surface-elevated shadow-2xl overflow-hidden"
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
        <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-alt shrink-0">
          {running && (
            <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
              <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          <span className="text-sm font-medium text-text-primary truncate flex-1" >{label || command}</span>
          {label && (
            <span className="text-[length:var(--text-2xs)] text-text-muted font-mono truncate min-w-0 max-w-[25%] shrink-0">{command}</span>
          )}
          {logPath && (
            <button
              type="button"
              onClick={() => window.electronAPI.shell.revealInFolder(logPath)}
              className="shrink-0 flex items-center gap-1 max-w-[40%] text-[length:var(--text-2xs)] font-mono text-text-muted hover:text-accent transition-colors"
              
            >
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
              <span className="truncate">{logPath}</span>
            </button>
          )}
          <span className="text-[length:var(--text-11)] text-text-secondary shrink-0">
            {running ? "运行中" : "已结束"}
          </span>
          {onStop && running && (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 px-2.5 py-1 rounded-[var(--radius-lg)] bg-danger-soft text-danger text-xs hover:bg-danger-bg transition-colors whitespace-nowrap"
            >停止运行</button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-6 h-6 rounded-[var(--radius-lg)] flex items-center justify-center text-text-secondary hover:bg-danger-soft hover:text-danger transition-colors"
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
          className="shell-output flex-1 min-h-0 overflow-y-auto px-4 py-3 bg-[var(--color-sidebar)]/40 font-mono text-[length:var(--text-caption)] leading-relaxed"
        >
          {truncated && (
            <div className="text-[length:var(--text-code)] text-warning mb-2 break-all">
              日志较大,仅显示最近输出(完整: {logPath})
            </div>
          )}
          {logs ? (
            logs.length === 0 ? (
              <span className="text-text-secondary">等待输出...</span>
            ) : (
              logs.map((line) => (
                <LogRow key={line.id} line={line} />
              ))
            )
          ) : content ? (
            <pre className="whitespace-pre-wrap break-words text-text-primary leading-relaxed" dangerouslySetInnerHTML={{ __html: ansiToHtml(content) }} />
          ) : (
            <span className="text-text-secondary">{running ? "等待输出…" : "(无输出)"}</span>
          )}
        </div>

        {/* 底部附加区（可选——LogOverlay 的修复按钮等） */}
        {footer && (
          <div className="shrink-0 px-4 py-2 bg-surface-alt/60">{footer}</div>
        )}

        {/* 回底按钮:滚离底部时显示,点击贴底并恢复自动跟随 */}
        {awayFromBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute right-4 bottom-10 w-8 h-8 rounded-full bg-accent text-text-inverse shadow-lg flex items-center justify-center hover:bg-accent-hover transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/></svg>
          </button>
        )}
      </div>
    </Modal>
  );
}
