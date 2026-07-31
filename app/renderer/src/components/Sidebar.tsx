import { useState, useCallback } from "react";
import { SessionHistory } from "./SessionHistory";
import { DesignSessionList } from "./DesignSessionList";
import { FileTreePanel } from "./FileTreePanel";
import { TaskPanel } from "./TaskPanel";
import { IssuePanel } from "./IssuePanel";
import { RunPanel } from "./RunPanel";
import { useTabStore } from "../stores/tab-store";
import { useThemeStore } from "../stores/theme-store";

type SidebarTab = "sessions" | "files";
type DrawerTab = "tasks" | "issues" | "runs";

interface SidebarProps {
  projectPath: string;
  projectId: string;
  projectName: string;
  projectExists: boolean;
  activeSessionId?: string;
  sessionRefreshKey?: number;
  onNewSession?: () => void;
  onNewDesignSession?: () => void;
  onSessionClick?: (sessionId: string) => void;
  onSessionDelete?: (sessionId: string) => void;
  onFileClick?: (filePath: string, fileName: string) => void;
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onRenameProject?: () => void;
  onSettings?: () => void;
  onShowUpdate?: () => void;
}

export function Sidebar({
  projectPath, projectId, projectName, projectExists,
  activeSessionId, sessionRefreshKey,
  onNewSession, onNewDesignSession, onSessionClick, onSessionDelete,
  onFileClick, onNewProject, onOpenProject, onRenameProject,
  onSettings, onShowUpdate,
}: SidebarProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<SidebarTab>("sessions");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("tasks");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);

  const toggleTheme = useCallback(() => {
    useThemeStore.getState().toggle();
  }, []);

  const toggleDrawer = useCallback((tab: DrawerTab) => {
    if (drawerTab === tab && drawerOpen) {
      setDrawerOpen(false);
    } else {
      setDrawerTab(tab);
      setDrawerOpen(true);
    }
  }, [drawerTab, drawerOpen]);

  const projectDeleted = !projectExists && !!projectId;

  return (
    <aside className="sidebar">
      {/* Drag strip — macOS 窗口按钮由系统渲染，此处仅占位 */}
      <div className="sb-drag-strip" />

      {/* Project name + actions */}
      <div className="sb-project-area">
        <div className="sb-project-name" onClick={onOpenProject}>
          <span className="sb-proj-dot" />
          <span>{projectDeleted ? projectName + "（已删除）" : projectName}</span>
        </div>
        <div className="sb-plus-wrap">
          <button className="sb-plus-btn" title="新建…" onClick={() => setPlusOpen(!plusOpen)}>+</button>
          {plusOpen && (
            <div className="sb-dropdown open">
              <button className="sb-dropdown-item" onClick={() => { setPlusOpen(false); onNewProject?.(); }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="10" height="10" rx="3"/><path d="M3 7h10M7 3v5"/></svg>
                新建项目
              </button>
              <button className="sb-dropdown-item" onClick={() => { setPlusOpen(false); onOpenProject?.(); }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 4.5v7a1 1 0 001 1h10a1 1 0 001-1v-7M2 4.5L8 8l6-3.5"/></svg>
                打开项目
              </button>
              <button className="sb-dropdown-item" onClick={() => { setPlusOpen(false); onRenameProject?.(); }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M14.5 1.5l-3 3-1.5-1.5 3-3"/><path d="M11 4.5l-9 9v1.5H3.5l9-9"/></svg>
                重命名项目
              </button>
              <div className="sb-dropdown-div" />
              <button className="sb-dropdown-item" onClick={() => { setPlusOpen(false); window.electronAPI?.window?.newWindow?.(); }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3" y="3" width="10" height="10" rx="3"/><path d="M8 4v8M4 8h8"/></svg>
                新建窗口
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs: 会话 | 文件 */}
      <div className="sb-tabs">
        <button className={`sb-tab ${activeTab === "sessions" ? "active" : ""}`} onClick={() => setActiveTab("sessions")}>会话</button>
        <button className={`sb-tab ${activeTab === "files" ? "active" : ""}`} onClick={() => setActiveTab("files")}>文件</button>
      </div>

      {/* Content */}
      <div className="sb-content">
        {activeTab === "sessions" ? (
          <div className="sb-session-lists flex flex-col min-h-0 flex-1">
            <div className="sb-label">
              会话
              <div style={{ position: "relative" }}>
                <button className="sb-label-btn" onClick={() => setSessionMenuOpen(!sessionMenuOpen)}>+ 新建</button>
                {sessionMenuOpen && (
                  <div className="sb-dropdown open" style={{ position: "absolute", right: 0, top: "100%", zIndex: 10 }}>
                    <button className="sb-dropdown-item" onClick={() => { setSessionMenuOpen(false); onNewSession?.(); }}>开发会话</button>
                    <button className="sb-dropdown-item" onClick={() => { setSessionMenuOpen(false); onNewDesignSession?.(); }}>设计会话</button>
                  </div>
                )}
              </div>
            </div>
            <SessionHistory
              projectPath={projectPath}
              onSessionClick={onSessionClick}
              onNewSession={onNewSession}
              onSessionDelete={onSessionDelete}
              activeSessionId={activeSessionId}
              refreshKey={sessionRefreshKey}
              hideNewButton
              hideEmptyState
            />
            <DesignSessionList
              projectPath={projectPath}
              onSessionClick={onSessionClick}
              onNewDesignSession={onNewDesignSession}
              onSessionDelete={onSessionDelete}
              activeSessionId={activeSessionId}
              refreshKey={sessionRefreshKey}
              hideNewButton
              hideEmptyState
            />
          </div>
        ) : (
          <FileTreePanel
            projectPath={projectPath}
            onFileClick={onFileClick}
          />
        )}
      </div>

      {/* Drawer — Task / Issue / Run panels */}
      <div className={`sb-drawer ${drawerOpen ? "open" : ""} ${drawerTab === "tasks" ? "ptr-left" : drawerTab === "issues" ? "ptr-mid" : "ptr-right"}`}>
        <div className="sb-drawer-body-wrap">
          <div className="sb-drawer-body">
            {drawerTab === "tasks" && <TaskPanel projectPath={projectPath} onCollapse={() => setDrawerOpen(false)} />}
            {drawerTab === "issues" && <IssuePanel projectPath={projectPath} onCollapse={() => setDrawerOpen(false)} />}
            {drawerTab === "runs" && <RunPanel projectPath={projectPath} onCollapse={() => setDrawerOpen(false)} />}
          </div>
        </div>
        <div className="sb-drawer-arrow" />
      </div>

      {/* Footer */}
      <div className="sb-foot">
        <div className="sb-foot-row">
          <div className="sb-seg-control">
            <button className={`sb-seg-btn ${drawerTab === "tasks" && drawerOpen ? "active" : ""} ${drawerTab === "tasks" ? "on" : ""}`} onClick={() => toggleDrawer("tasks")}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3h10v2H3zM3 7h7v2H3zM3 11h5v2H3z"/><circle cx="13" cy="6" r="2"/></svg>
              <span className="sb-seg-label">任务</span>
            </button>
            <button className={`sb-seg-btn ${drawerTab === "issues" && drawerOpen ? "active" : ""}`} onClick={() => toggleDrawer("issues")}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/></svg>
              <span className="sb-seg-label">Issue</span>
            </button>
            <button className={`sb-seg-btn ${drawerTab === "runs" && drawerOpen ? "active" : ""}`} onClick={() => toggleDrawer("runs")}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="5,3 15,8 5,13"/></svg>
              <span className="sb-seg-label">运行</span>
            </button>
          </div>
        </div>
        <div className="sb-foot-bottom">
          <button className="sb-foot-btn has-dot" onClick={onSettings} title="设置">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
          <button className="sb-foot-btn" onClick={toggleTheme} title="切换主题">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="3"/><path d="M8 1v1M8 14v1M2.8 2.8l.7.7M12.5 12.5l.7.7M1 8h1M14 8h1"/></svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
