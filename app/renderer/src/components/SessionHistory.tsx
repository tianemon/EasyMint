import { useState, useEffect, useCallback } from "react";

interface SessionHistoryProps {
  projectId: string;
}

export function SessionHistory({ projectId }: SessionHistoryProps): JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessions = useCallback(() => {
    setLoading(true);
    window.electronAPI.session.list(projectId).then((list) => {
      const sorted = [...list].sort(
        (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
      );
      setSessions(sorted);
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
    <div className="flex flex-col h-full bg-surface-alt">
      <div className="p-3 border-b border-border text-sm font-medium text-text-secondary">
        对话历史
      </div>
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
          加载中...
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
              className="group flex items-center w-full text-left px-4 py-3 hover:bg-surface-hover transition-colors border-b border-border cursor-pointer"
              onClick={() => window.electronAPI.session.resume(s.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{s.title}</div>
                <div className="text-xs text-text-secondary mt-1">
                  {formatDate(s.lastActiveAt)}
                </div>
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
