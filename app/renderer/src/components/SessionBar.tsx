import { useState, useEffect, useRef } from "react";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";

interface SessionBarProps {
  projectPath: string;
  onSessionClick?: (sessionId: string) => void;
  onNewSession?: () => void;
  onNewDesignSession?: () => void;
  onNewGroupSession?: () => void;
  refreshKey?: number;
}

interface ArchivedSession {
  sessionId: string;
  title: string;
  updatedAt: number;
  pinnedAt?: number;
  archivedAt?: number;
}

/** 会话功能条:归档 + 新建 平级(各自展开自己的列表) */
export function SessionBar(props: SessionBarProps): JSX.Element {
  const { projectPath, onNewSession, onNewDesignSession, onNewGroupSession, onSessionClick, refreshKey } = props;
  const [showArchive, setShowArchive] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
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

  // 点击外部关闭
  useEffect(() => {
    if (!showArchive && !showNewMenu) return;
    const onClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setShowArchive(false);
        setShowNewMenu(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showArchive, showNewMenu]);

  return (
    <div ref={barRef} className="sb-label flex items-center justify-between" style={{ padding: "var(--s3) var(--s2) var(--s1)" }}>
      {/* 归档按钮(仅时钟图标) */}
      <button
        className={`flex items-center justify-center w-6 h-6 rounded-md transition-colors ${showArchive ? "bg-surface-hover text-text-primary" : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"}`}
        title="归档会话"
        onClick={() => { setShowArchive(!showArchive); setShowNewMenu(false); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </button>

      {/* 新建按钮(气泡加号,略大于归档) */}
      <button
        className={`flex items-center justify-center w-[26px] h-[26px] rounded-md transition-colors ${showNewMenu ? "bg-surface-hover text-text-primary" : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"}`}
        title="新建会话"
        onClick={() => { setShowNewMenu(!showNewMenu); setShowArchive(false); }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-[15px] h-[15px]">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M9 10h6" />
          <path d="M12 7v6" />
        </svg>
      </button>

      {/* 归档列表(对齐任务面板抽屉风格:sidebar-active 底 + 圆角 + 阴影) */}
      {showArchive && (
        <div className="absolute top-full left-3 right-3 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-sidebar-active shadow-lg z-10">
          {archived.length > 0 ? (
            archived.map((s) => (
              <div key={s.sessionId} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors cursor-pointer text-xs border-b border-border/50 last:border-0" onClick={() => { onSessionClick?.(s.sessionId); setShowArchive(false); }}>
                <span className="flex-1 min-w-0 truncate">{s.title}</span>
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-[11px] text-text-secondary text-center">暂无归档会话</div>
          )}
        </div>
      )}

      {/* 新建菜单 */}
      {showNewMenu && (
        <div className="sb-dropdown open" style={{ position: "absolute", left: "auto", right: -8, top: "28px", width: "max-content", minWidth: 0, zIndex: 10, padding: 2 }}>
          <button className="sb-dropdown-item" style={{ padding: "4px 10px" }} onClick={() => { setShowNewMenu(false); onNewSession?.(); }}>开发会话</button>
          <button className="sb-dropdown-item" style={{ padding: "4px 10px" }} onClick={() => { setShowNewMenu(false); onNewDesignSession?.(); }}>设计会话</button>
          <button className="sb-dropdown-item" style={{ padding: "4px 10px" }} onClick={() => { setShowNewMenu(false); onNewGroupSession?.(); }}>群聊会话</button>
        </div>
      )}
    </div>
  );
}
