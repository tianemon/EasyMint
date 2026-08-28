import { useState, useEffect, useRef } from "react";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";

interface SessionBarProps {
  projectPath: string;
  onSessionClick?: (sessionId: string) => void;
  onNewSession?: () => void;
  refreshKey?: number;
  /** 归档会话恢复成功回调(触发主列表刷新) */
  onRestored?: () => void;
}

interface ArchivedSession {
  sessionId: string;
  title: string;
  updatedAt: number;
  pinnedAt?: number;
  archivedAt?: number;
}

/** 归档时间显示:今天 HH:MM / 昨天 / M月D日 / YYYY年M月D日 */
function fmtArchiveTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (startOfDay === startOfToday) {
    return `今天 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (startOfDay === startOfToday - 86400000) return "昨天";
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 会话功能条:归档 + 新建 平级(各自展开自己的列表) */
export function SessionBar(props: SessionBarProps): JSX.Element {
  const { projectPath, onNewSession, onSessionClick, refreshKey, onRestored } = props;
  const [showArchive, setShowArchive] = useState(false);
  const [archived, setArchived] = useState<ArchivedSession[]>([]);
  const barRef = useRef<HTMLDivElement>(null);

  // 加载归档会话(复用 conv.list 返回的 archivedAt 过滤)
  const loadArchived = () => {
    const path = projectPath || getWorkspaceDir();
    window.electronAPI.conv.list(path).then((sessions) => {
      setArchived((sessions as ArchivedSession[]).filter((s) => s.archivedAt));
    }).catch(() => setArchived([]));
  };
  useEffect(() => { loadArchived(); }, [projectPath, refreshKey]);

  // 恢复归档会话:取消归档标记 + 移除列表 + 通知主列表刷新
  const handleRestore = async (sessionId: string) => {
    await window.electronAPI.conv.unarchiveSession(sessionId);
    setArchived((prev) => prev.filter((s) => s.sessionId !== sessionId));
    onRestored?.();
  };

  // 点击外部关闭
  useEffect(() => {
    if (!showArchive) return;
    const onClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setShowArchive(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showArchive]);

  return (
    <div ref={barRef} className="sb-label flex items-center justify-between" style={{ padding: "var(--s3) var(--s2) var(--s1)" }}>
      {/* 归档按钮(仅时钟图标) */}
      <button
        className={`flex items-center justify-center w-6 h-6 rounded-md transition-colors ${showArchive ? "bg-surface-hover text-text-primary" : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"}`}
        title="归档会话"
        onClick={() => { setShowArchive(!showArchive); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </button>

      {/* 新建按钮:直接新建会话(无菜单) */}
      <button
        className="flex items-center justify-center w-[26px] h-[26px] rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
        title="新建会话"
        onClick={() => { onNewSession?.(); setShowArchive(false); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px]">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M9 10h6" />
          <path d="M12 7v6" />
        </svg>
      </button>

      {/* 归档列表:浮层底色 + 行圆角块(标题 + 下方时间 + 悬停恢复) */}
      {showArchive && (
        <div className="archive-panel-in absolute top-full left-3 right-3 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-elevated shadow-lg z-10 p-1.5">
          {archived.length > 0 ? (
            archived.map((s) => (
              <div
                key={s.sessionId}
                className="group flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-surface-hover transition-colors cursor-pointer"
                onClick={() => { onSessionClick?.(s.sessionId); setShowArchive(false); }}
                title="打开会话"
              >
                <div className="flex-1 min-w-0 leading-tight">
                  <div className="text-xs text-text-primary truncate">{s.title}</div>
                  <div className="text-[length:var(--text-2xs)] text-text-muted mt-0.5">{s.archivedAt ? fmtArchiveTime(s.archivedAt) : ""}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 px-1.5 py-0.5 rounded-md text-[length:var(--text-11)] text-text-secondary border border-border/50 bg-surface/60 hover:text-text-primary hover:bg-surface-hover transition-all opacity-0 group-hover:opacity-100"
                  title="恢复到会话列表"
                  onClick={(e) => { e.stopPropagation(); handleRestore(s.sessionId); }}
                >
                  恢复
                </button>
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-[length:var(--text-11)] text-text-secondary text-center">暂无归档会话</div>
          )}
        </div>
      )}
    </div>
  );
}
