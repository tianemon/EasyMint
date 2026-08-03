import { useEffect, useRef, useState } from "react";

/**
 * 后台命令输出查看弹层 — 对齐 Agent 过程查看(纯文本流)。
 * 数据三层:
 *  1. 打开时加载日志尾部 100KB(shell.readLog)
 *  2. 运行中订阅 agent:shell-output(按 id 过滤)实时追加
 *  3. 自动滚动贴底;命令结束保留已显示内容
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

  // 滚动贴底
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [content]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="flex flex-col w-[720px] max-w-[92vw] h-[68vh] rounded-[12px] border border-border bg-surface-elevated shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-accent-bg">
          <svg className="animate-spin text-accent shrink-0" width="13" height="13" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="text-sm font-medium text-text-primary truncate flex-1 font-mono" title={command}>{command}</span>
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

        {/* 输出区(纯文本 mono,自动换行) */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 bg-[var(--color-sidebar)]/40">
          {truncated && (
            <div className="text-[11px] text-warning mb-2 break-all">
              日志较大,仅显示最近输出(完整: {logPath})
            </div>
          )}
          <pre className="whitespace-pre-wrap break-words font-mono text-xs text-text-primary leading-relaxed">
            {content || (running ? "等待输出…" : "(无输出)")}
          </pre>
        </div>
      </div>
    </div>
  );
}
