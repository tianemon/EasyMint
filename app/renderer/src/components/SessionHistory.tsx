import { useState, useEffect, useCallback, useRef } from "react";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";
import { sessionListActions } from "../stores/session-list-actions";
import { useTabStore } from "../stores/tab-store";


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
  onSessionDelete?: (sessionId: string) => void;
  /** 会话归档成功回调(触发归档列表刷新) */
  onArchived?: () => void;
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
  onSessionDelete,
  onArchived,
  refreshKey,
}: SessionHistoryProps): JSX.Element {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [designIds, setDesignIds] = useState<Set<string>>(new Set());
  // 活跃会话集合(主进程 activeChats 内存态):状态点 绿=激活 / 灰白=未激活
  const [activeSessions, setActiveSessions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [menu, setMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, sessionId: "", title: "", pinned: false });

  const initialLoadDone = useRef(false);

  const refreshActive = useCallback(() => {
    window.electronAPI.agent.activeSessions()
      .then((ids) => setActiveSessions(new Set(ids)))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    const path = projectPath || getWorkspaceDir();
    if (!initialLoadDone.current) setLoading(true);
    setError(null);
    window.electronAPI.conv.list(path)
      .then((data) => { setSessions(data); initialLoadDone.current = true; })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
    // 设计会话 ID 集合（区分圆点/菱形点）
    window.electronAPI.conv.designSessions()
      .then((ids) => setDesignIds(new Set(ids)))
      .catch(() => {});
    refreshActive();
  }, [projectPath, refreshActive]);

  // 会话创建/关闭广播 → 刷新活跃状态点
  useEffect(() => {
    const off1 = window.electronAPI.agent.onChatSession(() => refreshActive());
    const off2 = window.electronAPI.agent.onChatClosed(() => refreshActive());
    return () => { off1(); off2(); };
  }, [refreshActive]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (refreshKey) load(); }, [refreshKey, load]);
  // 允许其他组件（如 askWorkspace 后台删会话）触发本列表刷新
  useEffect(() => {
    sessionListActions.register(load);
    return () => sessionListActions.unregister();
  }, [load]);
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

  // 删除前先弹确认(自定义弹窗,与项目弹层风格一致)——直接删除不可恢复
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const handleDelete = () => {
    if (!menu.sessionId) return;
    setPendingDelete(menu.sessionId);
    setMenu((m) => ({ ...m, visible: false }));
  };
  const doDelete = async (sessionId: string) => {
    // 先结束内存会话(若活跃)——否则删除记录后会话还在后台跑(委派/shell 继续),列表消失无法管理
    await window.electronAPI.agent.killSession(sessionId);
    const path = projectPath || getWorkspaceDir();
    await window.electronAPI.conv.delete(sessionId, path);
    onSessionDelete?.(sessionId);
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    refreshActive();
    setPendingDelete(null);
  };

  // 关闭该会话的 tab(归档/结束会话时:会话从列表移除,tab 不应残留)
  const closeTabBySession = (sessionId: string) => {
    const ts = useTabStore.getState();
    const tab = ts.tabs.find((t) => t.sessionId === sessionId);
    if (tab) ts.closeTab(tab.id);
  };

  // 右键「结束会话」:用户明确点击,立即 kill(不做延迟回收)
  const handleKillSession = async () => {
    if (!menu.sessionId) return;
    await window.electronAPI.agent.killSession(menu.sessionId);
    closeTabBySession(menu.sessionId);
    refreshActive();
    setMenu((m) => ({ ...m, visible: false }));
  };

  // 右键「归档」:从列表移除,会话文件保留(archived-sessions.json 标记,SDK 无自动清理)
  const handleArchive = async () => {
    if (!menu.sessionId) return;
    await window.electronAPI.conv.archiveSession(menu.sessionId);
    setSessions((prev) => prev.filter((s) => s.sessionId !== menu.sessionId));
    closeTabBySession(menu.sessionId);
    refreshActive();
    setMenu((m) => ({ ...m, visible: false }));
    onArchived?.();
  };

  const commitRename = async () => {
    if (!editingId) return;
    const title = editTitle.trim();
    if (title) {
      const path = projectPath || getWorkspaceDir();
      await window.electronAPI.conv.rename(editingId, title, path);
      setSessions((prev) => prev.map((s) => (s.sessionId === editingId ? { ...s, title } : s)));
      // 同步更新已打开的 Tab 标题
      const ts = useTabStore.getState();
      const tab = ts.tabs.find((t) => t.sessionId === editingId);
      if (tab) ts.updateTab(tab.id, { title });
    }
    setEditingId(null);
  };

  const pinned = sessions.filter((s) => s.pinnedAt && !s.archivedAt);
  const unpinned = sessions.filter((s) => !s.pinnedAt && !s.archivedAt);

  // 日期分组：今天 / 之前（7 天内）/ 更早（7 天前）
  const todayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const today = unpinned.filter((s) => s.updatedAt >= todayStart);
  const recent = unpinned.filter((s) => s.updatedAt < todayStart && s.updatedAt >= weekAgo);
  const older = unpinned.filter((s) => s.updatedAt < weekAgo);

  return (
    <div className="flex flex-col h-full">
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
        <div className="flex-1 overflow-y-auto">
          {pinned.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] text-text-secondary font-medium">置顶</div>
              {pinned.map((s) => (
                <SessionItemRow key={s.sessionId} session={s} active={activeSessionId === s.sessionId} isDesign={designIds.has(s.sessionId)} activeSessions={activeSessions} editingId={editingId} editTitle={editTitle} onSelect={onSessionClick} onContextMenu={handleContextMenu} onEditTitle={setEditTitle} onCommitRename={commitRename} onCancelEdit={() => setEditingId(null)} />
              ))}
            </div>
          )}
          {today.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] text-text-secondary font-medium">今天</div>
              {today.map((s) => (
                <SessionItemRow key={s.sessionId} session={s} active={activeSessionId === s.sessionId} isDesign={designIds.has(s.sessionId)} activeSessions={activeSessions} editingId={editingId} editTitle={editTitle} onSelect={onSessionClick} onContextMenu={handleContextMenu} onEditTitle={setEditTitle} onCommitRename={commitRename} onCancelEdit={() => setEditingId(null)} />
              ))}
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] text-text-secondary font-medium">之前</div>
              {recent.map((s) => (
                <SessionItemRow key={s.sessionId} session={s} active={activeSessionId === s.sessionId} isDesign={designIds.has(s.sessionId)} activeSessions={activeSessions} editingId={editingId} editTitle={editTitle} onSelect={onSessionClick} onContextMenu={handleContextMenu} onEditTitle={setEditTitle} onCommitRename={commitRename} onCancelEdit={() => setEditingId(null)} />
              ))}
            </div>
          )}
          {older.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[11px] text-text-secondary font-medium">更早</div>
              {older.map((s) => (
                <SessionItemRow key={s.sessionId} session={s} active={activeSessionId === s.sessionId} isDesign={designIds.has(s.sessionId)} activeSessions={activeSessions} editingId={editingId} editTitle={editTitle} onSelect={onSessionClick} onContextMenu={handleContextMenu} onEditTitle={setEditTitle} onCommitRename={commitRename} onCancelEdit={() => setEditingId(null)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Context menu —— hover 项内缩圆角(圆角外不露尖角),无分隔线 */}
      {menu.visible && (
        <div className="fixed z-[100] bg-surface-elevated border border-border rounded-lg shadow-xl py-1 px-1 min-w-[96px]" style={{ left: menu.x, top: menu.y }}
          ref={(el) => {
            if (!el) return;
            const h = el.offsetHeight;
            if (menu.y + h > window.innerHeight) {
              el.style.top = "auto";
              el.style.bottom = `${window.innerHeight - menu.y}px`;
            }
          }}>
          <button className="w-full text-left px-1.5 py-1 text-sm text-text-primary hover:bg-surface-hover rounded-md transition-colors flex items-center gap-1.5" onClick={handlePin}>
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="16" x2="12" y2="2"/><polyline points="6 8 12 2 18 8"/></svg>
            {menu.pinned ? "取消置顶" : "置顶"}
          </button>
          <button className="w-full text-left px-1.5 py-1 text-sm text-text-primary hover:bg-surface-hover rounded-md transition-colors flex items-center gap-1.5" onClick={handleRename}>
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            重命名
          </button>
          <button className="w-full text-left px-1.5 py-1 text-sm text-text-primary hover:bg-surface-hover rounded-md transition-colors flex items-center gap-1.5" onClick={handleArchive}>
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 8l-2-4H4L2 8"/><path d="M2 8v12h20V8"/><path d="M8 13h8"/></svg>
            归档
          </button>
          {activeSessions.has(menu.sessionId) && (
            <button className="w-full text-left px-1.5 py-1 text-sm text-danger hover:bg-danger-bg rounded-md transition-colors flex items-center gap-1.5" onClick={handleKillSession}>
              <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              结束会话
            </button>
          )}
          <button className="w-full text-left px-1.5 py-1 text-sm text-danger hover:bg-danger-bg rounded-md transition-colors flex items-center gap-1.5" onClick={handleDelete}>
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            删除
          </button>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {pendingDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onClick={() => setPendingDelete(null)}>
          <div
            className="bg-surface border border-border rounded-xl p-5 max-w-sm w-full shadow-2xl mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-medium text-text-primary mb-2">删除会话</div>
            <p className="text-xs text-text-secondary mb-4">
              确定删除「{sessions.find((s) => s.sessionId === pendingDelete)?.title ?? "该会话"}」吗？会话记录将永久删除，此操作不可恢复。
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-4 py-1.5 rounded-lg bg-surface-alt text-text-secondary text-xs hover:bg-surface-hover hover:text-text-primary transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => doDelete(pendingDelete)}
                className="px-4 py-1.5 rounded-lg bg-danger text-text-inverse text-xs font-medium hover:opacity-90 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Row component ──

interface RowProps {
  session: SessionItem;
  active: boolean;
  isDesign?: boolean;
  editingId: string | null;
  editTitle: string;
  onSelect?: (sessionId: string) => void;
  onContextMenu: (e: React.MouseEvent, s: SessionItem) => void;
  onEditTitle: (v: string) => void;
  onCommitRename: () => void;
  onCancelEdit: () => void;
  /** 活跃会话集合(主进程 activeChats):状态点颜色 绿=激活 / 灰白=未激活 */
  activeSessions: Set<string>;
}

function SessionItemRow({ session, active, isDesign, activeSessions, editingId, editTitle, onSelect, onContextMenu, onEditTitle, onCommitRename, onCancelEdit }: RowProps): JSX.Element {
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
      className={`sb-item session-item ${active ? "active" : ""} ${isArchived ? "opacity-70" : ""}`}
      onClick={() => onSelect?.(session.sessionId)}
      onContextMenu={(e) => onContextMenu(e, session)}
    >
      {isArchived ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="w-3.5 h-3.5 shrink-0 mr-2 text-text-muted"><circle cx="8" cy="8" r="6"/><path d="M8 4v5M8 8l2.5 2.5" strokeLinecap="round"/></svg>
      ) : (
        // 状态点:激活(主进程 activeChats 有该会话)=绿 / 未激活=灰白;设计会话菱形、普通圆
        <span className={`w-[6px] h-[6px] shrink-0 mr-[-2px] ${activeSessions.has(session.sessionId) ? "bg-success" : "bg-dot-gray"} ${isDesign ? "rotate-45" : "rounded-full"}`} title={activeSessions.has(session.sessionId) ? "会话激活中" : "会话未激活"} />
      )}
      <span className="flex-1 min-w-0 truncate">{session.title}</span>
      <span className="sb-item-meta">{fmtDate(session.updatedAt)}</span>
    </div>
  );
}

// ── Helpers ──

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    // 今天组内直接显示时分
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
