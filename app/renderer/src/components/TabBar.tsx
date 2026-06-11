import { useTabStore } from "../stores/tab-store";

function isTabRunning(tab: { type: string; sessionId?: string }, runningSessions: Set<string>): boolean {
  return tab.type === "chat" && !!tab.sessionId && runningSessions.has(tab.sessionId);
}

export function TabBar(): JSX.Element {
  const { tabs, activeTabId, setActiveTab, closeTab, runningSessions } = useTabStore();

  return (
    <div className="flex items-center h-9 bg-surface-alt border-b border-border shrink-0">
      {/* Tabs */}
      <div className="flex-1 flex items-center h-full overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-1.5 h-full px-3 text-xs cursor-pointer select-none shrink-0 border-r border-border transition-colors ${
                isActive
                  ? "bg-surface-elevated text-text-primary"
                  : "bg-transparent text-text-secondary hover:bg-surface-hover"
              }`}
            >
              {/* Dot — only for dirty (unsaved) files */}
              {(tab as { dirty?: boolean }).dirty && (
                <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
              )}
              {/* Title */}
              <span className="truncate max-w-[140px]">{tab.title}</span>
              {/* Close button — visible on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isTabRunning(tab, runningSessions)) {
                    if (!confirm("Mint 正在思考中，确认关闭吗？")) return;
                  }
                  closeTab(tab.id);
                }}
                className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-surface-hover transition-opacity text-text-secondary leading-none"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
