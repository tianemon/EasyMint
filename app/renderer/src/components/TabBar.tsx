import { useTabStore } from "../stores/tab-store";

function isTabRunning(tab: { type: string; sessionId?: string }, runningSessions: Set<string>): boolean {
  return tab.type === "chat" && !!tab.sessionId && runningSessions.has(tab.sessionId);
}

export function TabBar(): JSX.Element | null {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const runningSessions = useTabStore((s) => s.runningSessions);

  // 空 tab 时仍渲染空拖拽条（min-height 40px）：窗口顶部需要可拖拽区域
  if (tabs.length === 0) return <div className="tabbar-v3" />;

  return (
    <div className="tabbar-v3">
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        return (
          <div key={tab.id} className="flex items-center min-w-0">
            {i > 0 && <div className="tab-divider-v3" />}
            <button
              onClick={() => setActiveTab(tab.id)}
              className={`tab-v3 ${isActive ? "active" : ""}`}
              title={tab.title}
            >
              {(tab as { dirty?: boolean }).dirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 mr-1.5" />
              )}
              <span className="tab-text-v3"><span className="tab-text-inner">{tab.title}</span></span>
              <span
                className="tab-close-v3"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isTabRunning(tab, runningSessions)) {
                    if (!confirm("Mint 正在思考中，确认关闭吗？")) return;
                  }
                  closeTab(tab.id);
                }}
              >
                ×
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
