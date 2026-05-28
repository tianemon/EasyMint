import { useState, useEffect, useCallback } from "react";

interface SessionHistoryProps {
  projectId: string;
  onSessionClick?: (sessionId: string) => void;
  onNewSession?: () => void;
  activeSessionId?: string;
}

export function SessionHistory({
  projectId,
  onSessionClick,
  onNewSession,
  activeSessionId,
}: SessionHistoryProps): JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(() => {
    setLoading(true);
    setError(null);
    window.electronAPI.session
      .list(projectId)
      .then((list) => {
        const sorted = [...list].sort(
          (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
        );
        setSessions(sorted);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "加载对话历史失败");
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await window.electronAPI.session.delete(projectId, sessionId);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* New session button */}
      <div className="px-3 py-2 shrink-0">
        <button
          className="w-full py-1.5 border border-dashed border-accent text-accent text-sm rounded-lg hover:bg-accent/5 transition-colors"
          onClick={onNewSession}
        >
          + 新建会话
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
          加载中...
        </div>
      ) : error ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            className="px-3 py-1 text-xs bg-accent text-white rounded hover:bg-accent-hover transition-colors"
            onClick={loadSessions}
          >
            重试
          </button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
          暂无对话记录
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center w-full text-left px-3 py-2.5 hover:bg-surface-hover transition-colors cursor-pointer ${
                activeSessionId === s.id ? "bg-accent/10" : ""
              }`}
              onClick={() => onSessionClick?.(s.id)}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 mr-2.5 ${
                  s.status === "active" ? "bg-accent" : "bg-border"
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{s.title}</div>
                <div className="text-xs text-text-secondary mt-0.5">{formatDate(s.lastActiveAt)}</div>
              </div>
              <button
                className="ml-2 px-2 py-1 text-xs text-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded opacity-0 group-hover:opacity-100 transition-all"
                onClick={(e) => handleDelete(e, s.id)}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
