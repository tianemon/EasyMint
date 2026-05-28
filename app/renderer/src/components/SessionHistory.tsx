import { useState, useEffect } from "react";

interface SessionHistoryProps {
  projectId: string;
}

export function SessionHistory({ projectId }: SessionHistoryProps): JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    window.electronAPI.session.list(projectId).then(setSessions);
  }, [projectId]);

  return (
    <div className="flex flex-col h-full bg-surface-alt">
      <div className="p-3 border-b border-border text-sm font-medium text-text-secondary">
        对话历史
      </div>
      {sessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-text-secondary text-sm">
          暂无对话记录
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              className="w-full text-left px-4 py-3 hover:bg-surface-hover transition-colors border-b border-border"
              onClick={() => window.electronAPI.session.resume(s.id)}
            >
              <div className="text-sm font-medium">{s.title}</div>
              <div className="text-xs text-text-secondary mt-1">
                {new Date(s.lastActiveAt).toLocaleString("zh-CN")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
