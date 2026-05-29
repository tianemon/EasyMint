import { useState, useEffect, useCallback } from "react";

interface ConvMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface SessionHistoryProps {
  activeConvId?: string;
  onSessionClick?: (convId: string) => void;
  onNewSession?: () => void;
  /** Notify parent when a conversation is deleted so it can cleanup tabs */
  onSessionDelete?: (convId: string) => void;
}

export function SessionHistory({
  activeConvId,
  onSessionClick,
  onNewSession,
  onSessionDelete,
}: SessionHistoryProps): JSX.Element {
  const [convs, setConvs] = useState<ConvMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    window.electronAPI.conv.list()
      .then(setConvs)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  // Refresh on window focus
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await window.electronAPI.conv.delete(id);
    onSessionDelete?.(id);
    setConvs((prev) => prev.filter((c) => c.id !== id));
  };

  const startRename = (e: React.MouseEvent, id: string, currentTitle: string) => {
    e.stopPropagation();
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const commitRename = async () => {
    if (!editingId) return;
    const title = editTitle.trim();
    if (title) {
      await window.electronAPI.conv.update(editingId, { title });
      setConvs((prev) => prev.map((c) => (c.id === editingId ? { ...c, title } : c)));
    }
    setEditingId(null);
  };

  const grouped = groupByDate(convs);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 shrink-0">
        <button
          className="w-full py-1.5 border border-dashed border-accent text-accent text-sm rounded-lg hover:bg-accent/5 transition-colors"
          onClick={onNewSession}
        >
          + 新建会话
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">加载中...</div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <p className="text-red-400 text-sm">{error}</p>
          <button className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors" onClick={load}>重试</button>
        </div>
      ) : convs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">暂无对话记录</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {grouped.map((g) => (
            <div key={g.label}>
              <div className="px-3 py-1.5 text-[11px] text-text-secondary font-medium">{g.label}</div>
              {g.items.map((c) => (
                <div key={c.id}>
                  {editingId === c.id ? (
                    <div className="px-3 py-1 flex gap-1">
                      <input
                        autoFocus
                        className="flex-1 px-2 py-1 text-xs bg-surface border border-accent rounded outline-none text-text-primary"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                        onBlur={commitRename}
                      />
                    </div>
                  ) : (
                    <div
                      className={`group flex items-center w-full text-left px-3 py-2 hover:bg-surface-hover transition-colors cursor-pointer ${activeConvId === c.id ? "bg-accent/10" : ""}`}
                      onClick={() => onSessionClick?.(c.id)}
                      onDoubleClick={(e) => startRename(e, c.id, c.title)}
                      onContextMenu={(e) => { e.preventDefault(); startRename(e, c.id, c.title); }}
                    >
                      <span className="w-2 h-2 rounded-full bg-accent shrink-0 mr-2.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{c.title}</div>
                        <div className="text-xs text-text-secondary mt-0.5">{fmtDate(c.updatedAt)}</div>
                      </div>
                      <button
                        className="ml-2 px-2 py-1 text-xs text-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                        onClick={(e) => handleDelete(e, c.id)}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (diff < 172800000) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function groupByDate(convs: ConvMeta[]): { label: string; items: ConvMeta[] }[] {
  const now = new Date();
  const today: ConvMeta[] = [];
  const yesterday: ConvMeta[] = [];
  const older: ConvMeta[] = [];
  for (const c of convs) {
    const d = new Date(c.updatedAt);
    if (d.toDateString() === now.toDateString()) today.push(c);
    else if (new Date(now.getTime() - 86400000).toDateString() === d.toDateString()) yesterday.push(c);
    else older.push(c);
  }
  const result: { label: string; items: ConvMeta[] }[] = [];
  if (today.length) result.push({ label: "今天", items: today });
  if (yesterday.length) result.push({ label: "昨天", items: yesterday });
  if (older.length) result.push({ label: "更早", items: older });
  return result;
}
