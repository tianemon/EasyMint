import { useState, useEffect, useCallback, useRef } from "react";
import { useSettingsStore } from "../stores/settings-store";

function getWorkspaceDir(): string {
  const base = useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject";
  return `${base.replace(/\/$/, "")}/workspace/`;
}

interface SessionItem {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
  archivedAt?: number;
}

interface SessionHistoryProps {
  projectPath: string;
  activeSessionId?: string;
  onSessionClick?: (sessionId: string) => void;
  onNewSession?: () => void;
  onSessionDelete?: (sessionId: string) => void;
  refreshKey?: number;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  sessionId: string;
  title: string;
  pinned: boolean;
}

export function SessionHistory({
  projectPath,
  activeSessionId,
  onSessionClick,
  onNewSession,
  onSessionDelete,
  refreshKey,
}: SessionHistoryProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [menu, setMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, sessionId: "", title: "", pinned: false });
  const [showArchive, setShowArchive] = useState(false);
  const archiveRef = useRef<HTMLDivElement>(null);

  // Close archive popup on click outside
  useEffect(() => {
    if (!showArchive) return;
    const handler = (e: MouseEvent) => {
      if (archiveRef.current && !archiveRef.current.contains(e.target as Node)) {
        setShowArchive(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showArchive]);

  const load = useCallback(() => {
    const path = projectPath || getWorkspaceDir();
    setLoading(true);
    setError(null);
    window.electronAPI.conv.list(path)
      .then(setSessions)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [projectPath]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (refreshKey) load(); }, [refreshKey, load]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  // Close context menu on click outside or Escape
  useEffect(() => {
    const close = () => setMenu((m) => ({ ...m, visible: false }));
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, s: SessionItem) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ visible: true, x: e.clientX, y: e.clientY, sessionId: s.sessionId, title: s.title, pinned: !!s.pinnedAt });
  };

  const handleRename = () => {
    if (!menu.sessionId) return;
    setEditingId(menu.sessionId);
    setEditTitle(menu.title);
    setMenu((m) => ({ ...m, visible: false }));
  };

  const handlePin = async () => {
    if (!menu.sessionId) return;
    const nowPinned = await window.electronAPI.conv.togglePin(menu.sessionId);
    setSessions((prev) => prev.map((s) => s.sessionId === menu.sessionId ? { ...s, pinnedAt: nowPinned ? Date.now() : undefined } : s));
    setMenu((m) => ({ ...m, visible: false }));
  };

  const handleDelete = async () => {
    if (!menu.sessionId) return;
    const path = projectPath || getWorkspaceDir();
    await window.electronAPI.conv.delete(menu.sessionId, path);
    onSessionDelete?.(menu.sessionId);
    setSessions((prev) => prev.filter((s) => s.sessionId !== menu.sessionId));
    setMenu((m) => ({ ...m, visible: false }));
  };

  const commitRename = async () => {
    if (!editingId) return;
    const title = editTitle.trim();
    if (title) {
      const path = projectPath || getWorkspaceDir();
      await window.electronAPI.conv.rename(editingId, title, path);
      setSessions((prev) => prev.map((s) => (s.sessionId === editingId ? { ...s, title } : s)));
    }
    setEditingId(null);
  };

  const pinned = sessions.filter((s) => s.pinnedAt && !s.archivedAt);
  const archived = sessions.filter((s) => s.archivedAt);
  const unpinned = sessions.filter((s) => !s.pinnedAt && !s.archivedAt);
  const groups = groupByDate(unpinned);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 shrink-0">
        <button
          className="w-full py-1.5 border border-accent text-accent text-sm rounded-lg hover:bg-accent-subtle transition-colors"
          onClick={onNewSession}
        >
          + 新建会话
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">加载中...</div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <p className="text-danger text-sm">{error}</p>
          <button className="px-3 py-1 text-xs bg-accent text-text-inverse rounded hover:bg-accent-hover transition-colors" onClick={load}>重试</button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">暂无对话记录</div>
      ) : (
        <div className="flex-1 overflow-y-auto mx-3 rounded-xl bg-accent-subtle border border-accent-border-light">
          {pinned.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] text-text-secondary font-medium">置顶</div>
              {pinned.map((s) => (
                <SessionItemRow key={s.sessionId} session={s} active={activeSessionId === s.sessionId} editingId={editingId} editTitle={editTitle} onSelect={onSessionClick} onContextMenu={handleContextMenu} onEditTitle={setEditTitle} onCommitRename={commitRename} onCancelEdit={() => setEditingId(null)} />
              ))}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 py-1.5 text-[11px] text-text-secondary font-medium">{g.label}</div>
              {g.items.map((s) => (
                <SessionItemRow key={s.sessionId} session={s} active={activeSessionId === s.sessionId} editingId={editingId} editTitle={editTitle} onSelect={onSessionClick} onContextMenu={handleContextMenu} onEditTitle={setEditTitle} onCommitRename={commitRename} onCancelEdit={() => setEditingId(null)} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Archive clock button */}
      {archived.length > 0 && (
        <div className="shrink-0 px-3 pb-2 relative" ref={archiveRef}>
          <button
            className={`w-8 h-8 mx-auto rounded-md flex items-center justify-center transition-colors ${showArchive ? "bg-accent-bg text-accent" : "text-text-secondary hover:text-text-primary"}`}
            onClick={() => setShowArchive(!showArchive)}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-4 h-4"><circle cx="8" cy="8" r="6"/><path d="M8 4v5M8 7.5l2.5 1.5" strokeLinecap="round"/></svg>
          </button>
          {showArchive && (
            <div className="absolute bottom-full left-3 right-3 mb-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-elevated shadow-lg">
              {archived.map((s) => (
                <SessionItemRow key={s.sessionId} session={s} active={activeSessionId === s.sessionId} editingId={editingId} editTitle={editTitle} onSelect={(sid) => { onSessionClick?.(sid); setShowArchive(false); }} onContextMenu={handleContextMenu} onEditTitle={setEditTitle} onCommitRename={commitRename} onCancelEdit={() => setEditingId(null)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Context menu */}
      {menu.visible && (
        <div className="fixed z-[100] bg-surface-elevated border border-border rounded-lg shadow-xl py-1 min-w-[120px]" style={{ left: menu.x, top: menu.y }}
          ref={(el) => {
            if (!el) return;
            const h = el.offsetHeight;
            if (menu.y + h > window.innerHeight) {
              el.style.top = "auto";
              el.style.bottom = `${window.innerHeight - menu.y}px`;
            }
          }}>
          <button className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover transition-colors flex items-center gap-2" onClick={handlePin}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="16" x2="12" y2="2"/><polyline points="6 8 12 2 18 8"/></svg>
            {menu.pinned ? "取消置顶" : "置顶"}
          </button>
          <button className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-surface-hover transition-colors flex items-center gap-2" onClick={handleRename}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            重命名
          </button>
          <div className="border-t border-border my-0.5" />
          <button className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-danger-bg transition-colors flex items-center gap-2" onClick={handleDelete}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            删除
          </button>
        </div>
      )}
    </div>
  );
}

// ── Row component ──

interface RowProps {
  session: SessionItem;
  active: boolean;
  editingId: string | null;
  editTitle: string;
  onSelect?: (sessionId: string) => void;
  onContextMenu: (e: React.MouseEvent, s: SessionItem) => void;
  onEditTitle: (v: string) => void;
  onCommitRename: () => void;
  onCancelEdit: () => void;
}

function SessionItemRow({ session, active, editingId, editTitle, onSelect, onContextMenu, onEditTitle, onCommitRename, onCancelEdit }: RowProps): JSX.Element {
  if (editingId === session.sessionId) {
    return (
      <div className="px-3 py-1 flex gap-1">
        <input
          autoFocus
          className="flex-1 px-2 py-1 text-xs bg-surface border border-accent rounded outline-none text-text-primary"
          value={editTitle}
          onChange={(e) => onEditTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onCommitRename(); if (e.key === "Escape") onCancelEdit(); }}
          onBlur={onCommitRename}
        />
      </div>
    );
  }

  const isArchived = !!session.archivedAt;

  return (
    <div
      className={`group flex items-center w-full text-left px-3 py-2 hover:bg-accent-subtle transition-colors cursor-pointer ${active ? "bg-accent-bg" : ""} ${isArchived ? "opacity-70" : ""}`}
      onClick={() => onSelect?.(session.sessionId)}
      onContextMenu={(e) => onContextMenu(e, session)}
    >
      {isArchived ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-3.5 h-3.5 shrink-0 mr-2 text-text-muted"><circle cx="8" cy="8" r="6"/><path d="M8 4v5M8 8l2.5 2.5" strokeLinecap="round"/></svg>
      ) : (
        <span className={`w-2 h-2 rounded-full shrink-0 mr-2.5 ${session.pinnedAt ? "bg-warning" : "bg-accent"}`} />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{session.title}</div>
        <div className="text-xs text-text-secondary mt-0.5">{fmtDate(session.updatedAt)}</div>
      </div>
      {session.pinnedAt && !isArchived && (
        <svg className="w-3 h-3 text-warning shrink-0 ml-1" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 3h-2v6h2l-3 3-3-3h2V5H9l3-3z"/></svg>
      )}
    </div>
  );
}

// ── Helpers ──

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (diff < 172800000) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function groupByDate(sessions: SessionItem[]): { label: string; items: SessionItem[] }[] {
  const now = new Date();
  const today: SessionItem[] = [];
  const yesterday: SessionItem[] = [];
  const older: SessionItem[] = [];
  for (const s of sessions) {
    const d = new Date(s.updatedAt);
    if (d.toDateString() === now.toDateString()) today.push(s);
    else if (new Date(now.getTime() - 86400000).toDateString() === d.toDateString()) yesterday.push(s);
    else older.push(s);
  }
  const result: { label: string; items: SessionItem[] }[] = [];
  if (today.length) result.push({ label: "今天", items: today });
  if (yesterday.length) result.push({ label: "昨天", items: yesterday });
  if (older.length) result.push({ label: "更早", items: older });
  return result;
}
