import { useTabStore } from "../stores/tab-store";
import { useDelegationStore } from "../stores/delegation-store";
import { WindowControls } from "./WindowControls";
import { confirmDialog } from "./ui/ConfirmDialog";

/** 关闭提醒判定:回合流式 ∪ 委派运行中 ∪ 后台 shell 运行中(按 sessionId 过滤) */
function isTabRunning(
  tab: { type: string; sessionId?: string },
  runningSessions: Set<string>,
  agentTasks: Array<{ sessionId?: string }>,
  shellTasks: Array<{ sessionId?: string }>,
): boolean {
  if (tab.type !== "chat" || !tab.sessionId) return false;
  const sid = tab.sessionId;
  return runningSessions.has(sid)
    || agentTasks.some((t) => !t.sessionId || t.sessionId === sid)
    || shellTasks.some((t) => !t.sessionId || t.sessionId === sid);
}

/** 提醒文案:按当前活跃事件区分(用户友好话术,不用开发术语) */
function runningHint(
  sid: string,
  runningSessions: Set<string>,
  agentTasks: Array<{ sessionId?: string }>,
  shellTasks: Array<{ sessionId?: string }>,
): string {
  if (runningSessions.has(sid)) return "Mint 正在思考中，确认关闭吗？";
  if (agentTasks.some((t) => !t.sessionId || t.sessionId === sid)) return "还有开发任务正在进行，关闭会中断任务，确认关闭吗？";
  if (shellTasks.some((t) => !t.sessionId || t.sessionId === sid)) return "后台命令还在运行，关闭后命令结果将无法显示在对话里，确认关闭吗？";
  return "确认关闭吗？";
}

export function TabBar(): JSX.Element | null {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const runningSessions = useTabStore((s) => s.runningSessions);
  // 委派/后台 shell 实时状态(关闭提醒用:委派运行中回合可能已结束,runningSessions 覆盖不到)
  const agentTasks = useDelegationStore((s) => s.agentTasks);
  const shellTasks = useDelegationStore((s) => s.shellTasks);

  // 侧边栏停在「文件」页签 → 右侧整块置空等用户点文件,标签栏一并隐藏
  const contentBlank = useTabStore((s) => s.isContentBlank());
  // 无"真实 tab"(chat 已有 sessionId 或 file tab)时隐藏 tab 条:
  // 初始空会话 tab(无 sessionId)不显示,发送后 sessionId 绑定自动出现。
  // 空 tab 时仍渲染空拖拽条（min-height 40px）：窗口顶部需要可拖拽区域
  const hasRealTabs = useTabStore((s) => s.tabs.some((t) => (t.type === "chat" && t.sessionId) || t.type === "file"));
  if (contentBlank || !hasRealTabs) return (
    <div className="tabbar-v3">
      <WindowControls />
    </div>
  );

  return (
    <div className="tabbar-v3">
      <WindowControls />
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTabId;
        return (
          <div key={tab.id} className="flex items-center min-w-0">
            {i > 0 && <div className="tab-divider-v3" />}
            <button
              onClick={() => {
                // 切到真实会话 tab → 关闭空会话 tab(与点击会话列表行为一致)
                if (tab.type === "chat" && tab.sessionId) {
                  useTabStore.getState().closeEmptyTab();
                }
                setActiveTab(tab.id);
              }}
              className={`tab-v3 ${isActive ? "active" : ""}`}
              title={tab.title}
            >
              {(tab as { dirty?: boolean }).dirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 mr-1.5" />
              )}
              <span className="tab-text-v3"><span className="tab-text-inner">{tab.title}</span></span>
              <span
                className="tab-close-v3"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (tab.type === "chat" && tab.sessionId && isTabRunning(tab, runningSessions, agentTasks, shellTasks)) {
                    const ok = await confirmDialog({
                      title: "关闭会话？",
                      message: runningHint(tab.sessionId, runningSessions, agentTasks, shellTasks),
                      confirmText: "关闭",
                    });
                    if (!ok) return;
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
