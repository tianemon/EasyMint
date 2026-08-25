import { useEffect, useRef, useState } from "react";

/**
 * 后台命令输出查看弹层 — 对齐 Agent 过程查看(纯文本流)。
 * 数据三层:
 *  1. 打开时加载日志尾部 100KB(shell.readLog)
 *  2. 运行中订阅 agent:shell-output(按 id 过滤)实时追加
 *  3. 自动滚动贴底(用户滚离底部停止跟随,可自由滚动;回底按钮恢复);命令结束保留已显示内容
 */
export function ShellProcessView({
  id,
  command,
  logPath,
  running,
  onClose,
}: {
  id: string;
  command: string;
  logPath: string;
  running: boolean;
  onClose: () => void;
}): JSX.Element {
  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 自动贴底跟随:用户滚离底部(dist>8)停止,回底按钮恢复
  const autoScrollRef = useRef(true);
  const lastUserInputRef = useRef(0);
  const [awayFromBottom, setAwayFromBottom] = useState(false);

  // 用户输入(wheel/touch/mousedown)标记——500ms 内的 scroll 变化视为用户滚动意图
  const markUserInput = (): void => { lastUserInputRef.current = Date.now(); };
  const handleUserInput = (): void => markUserInput();
  const handleScroll = (): void => {
    // 程序性贴底(无用户输入)不参与判定
    if (Date.now() - lastUserInputRef.current > 500) return;
    const el = scrollRef.current; if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distFromBottom < 8;
    autoScrollRef.current = atBottom;
    setAwayFromBottom(!atBottom);
  };
  const scrollToBottom = (): void => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    autoScrollRef.current = true;
    setAwayFromBottom(false);
  };

  // 打开/切换命令:加载日志尾部(dev server 日志可能 MB 级,只取最近输出)
  useEffect(() => {
    let cancelled = false;
    setContent("");
    setTruncated(false);
    (async () => {
      if (!logPath) return;
      const r = await window.electronAPI.shell.readLog(logPath);
      if (cancelled) return;
      setContent(r.content);
      setTruncated(r.truncated);
    })();
    return () => { cancelled = true; };
  }, [logPath, id]);

  // 实时输出订阅(按命令 id 过滤;chunk 追加)
  useEffect(() => {
    const unsub = window.electronAPI.agent.onShellOutput((data) => {
      if (data.id !== id) return;
      setContent((prev) => prev + data.chunk);
    });
    return unsub;
  }, [id]);

  // 滚动贴底(仅自动跟随态——用户滚动时可自由查看历史)
  useEffect(() => {
    if (!autoScrollRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="relative flex flex-col w-[720px] max-w-[92vw] h-[68vh] rounded-[12px] border border-border bg-surface-elevated shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-accent-bg">
          <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium text-text-primary truncate flex-1 font-mono" title={command}>{command}</span>
          {/* 日志文件路径:点击在文件夹中显示(不打开文件) */}
          <button
            type="button"
            onClick={() => window.electronAPI.shell.revealInFolder(logPath)}
            className="shrink-0 flex items-center gap-1 max-w-[220px] text-[10px] font-mono text-text-muted hover:text-accent transition-colors"
            title={`在文件夹中显示: ${logPath}`}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
            <span className="truncate">{logPath}</span>
          </button>
          <span className="text-[11px] text-text-secondary shrink-0">
            {running ? "运行中" : "已结束"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-6 h-6 rounded-[6px] flex items-center justify-center text-text-secondary hover:bg-accent-bg hover:text-text-primary transition-colors"
            title="关闭"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* 输出区(纯文本 mono,自动换行;可选中复制) */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={handleUserInput}
          onTouchStart={handleUserInput}
          onMouseDown={handleUserInput}
          className="shell-output flex-1 overflow-y-auto px-4 py-3 bg-[var(--color-sidebar)]/40"
        >
          {truncated && (
            <div className="text-[11px] text-warning mb-2 break-all">
              日志较大,仅显示最近输出(完整: {logPath})
            </div>
          )}
          {content ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs text-text-primary leading-relaxed">{content}</pre>
          ) : (
            <div>
              <span className="text-xs text-text-secondary">{running ? "等待输出…" : "(无输出)"}</span>
              {running && (
                <p className="text-[11px] text-text-muted mt-1.5 leading-relaxed">
                  若命令手动重定向了输出（如 <span className="font-mono">&gt; file 2&gt;&amp;1</span>），此处不会显示——可查看日志文件或重定向目标
                </p>
              )}
            </div>
          )}
        </div>

        {/* 回底按钮:滚离底部时显示,点击贴底并恢复自动跟随 */}
        {awayFromBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute right-4 bottom-4 w-8 h-8 rounded-full bg-accent text-text-inverse shadow-lg flex items-center justify-center hover:bg-accent-hover transition-colors"
            title="回到底部"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v9M4.5 8.5L8 12l3.5-3.5"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}
