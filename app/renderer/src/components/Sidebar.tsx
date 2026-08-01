import { useState, useCallback, useEffect, useRef } from "react";
import { SessionHistory } from "./SessionHistory";
import { FileTreePanel } from "./FileTreePanel";
import { TaskPanel } from "./TaskPanel";
import { IssuePanel } from "./IssuePanel";
import { RunPanel } from "./RunPanel";
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
  onSettings,
}: SidebarProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<SidebarTab>("sessions");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("tasks");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const segRef = useRef<HTMLDivElement>(null);

  // 检测是否有可用更新
  useEffect(() => {
    window.electronAPI?.app?.hasUpdate?.().then(({ hasUpdate: h }) => {
      setHasUpdate(h);
    }).catch(() => {});
  }, []);

  // 点击下拉菜单以外区域 → 关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (plusWrapRef.current && !plusWrapRef.current.contains(t)) setPlusOpen(false);
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(t)) setSessionMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 点击面板/seg 按钮以外区域 → 收起抽屉
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (drawerRef.current && drawerRef.current.contains(t)) return;
      if (segRef.current && segRef.current.contains(t)) return;
      setDrawerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [drawerOpen]);

  const mode = useThemeStore((s) => s.mode);
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
        <div className="sb-project-name">
          <span className="sb-project-name-clip">
            <span className="sb-project-name-inner">{projectDeleted ? projectName + "（已删除）" : projectName}</span>
          </span>
        </div>
        <div className="sb-plus-wrap" ref={plusWrapRef}>
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
            <div className="sb-label" ref={sessionMenuRef}>
              会话
              <button className="sb-label-btn" onClick={() => setSessionMenuOpen(!sessionMenuOpen)}>+ 新建</button>
              {sessionMenuOpen && (
                <div className="sb-dropdown open" style={{ position: "absolute", left: "auto", right: -8, top: "28px", width: "max-content", minWidth: 0, zIndex: 10, padding: 2 }}>
                  <button className="sb-dropdown-item" style={{ padding: "4px 10px" }} onClick={() => { setSessionMenuOpen(false); onNewSession?.(); }}>开发会话</button>
                  <button className="sb-dropdown-item" style={{ padding: "4px 10px" }} onClick={() => { setSessionMenuOpen(false); onNewDesignSession?.(); }}>设计会话</button>
                </div>
              )}
            </div>
            <SessionHistory
              projectPath={projectPath}
              onSessionClick={onSessionClick}
              onNewSession={onNewSession}
              onSessionDelete={onSessionDelete}
              activeSessionId={activeSessionId}
              refreshKey={sessionRefreshKey}
              hideNewButton
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
      <div ref={drawerRef} className={`sb-drawer ${drawerOpen ? "open" : ""} ${drawerTab === "tasks" ? "ptr-left" : drawerTab === "issues" ? "ptr-mid" : "ptr-right"}`}>
        <div className="sb-drawer-body-wrap">
          <div className="sb-drawer-body">
            {drawerTab === "tasks" && <TaskPanel onCollapse={() => setDrawerOpen(false)} />}
            {drawerTab === "issues" && <IssuePanel projectPath={projectPath} onCollapse={() => setDrawerOpen(false)} />}
            {drawerTab === "runs" && <RunPanel projectPath={projectPath} onCollapse={() => setDrawerOpen(false)} />}
          </div>
        </div>
        <div className="sb-drawer-arrow" />
      </div>

      {/* Footer */}
      <div className="sb-foot">
        <div className="sb-foot-row">
          <div className="sb-seg-control" ref={segRef}>
            <button className={`sb-seg-btn ${drawerTab === "tasks" && drawerOpen ? "active" : ""} ${drawerTab === "tasks" ? "on" : ""}`} onClick={() => toggleDrawer("tasks")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>
              <span className="sb-seg-label">任务</span>
            </button>
            <button className={`sb-seg-btn ${drawerTab === "issues" && drawerOpen ? "active" : ""}`} onClick={() => toggleDrawer("issues")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span className="sb-seg-label">Issue</span>
            </button>
            <button className={`sb-seg-btn ${drawerTab === "runs" && drawerOpen ? "active" : ""}`} onClick={() => toggleDrawer("runs")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              <span className="sb-seg-label">运行</span>
            </button>
          </div>
        </div>
        <div className="sb-foot-bottom">
          <button className={`sb-foot-btn ${hasUpdate ? "has-dot" : ""}`} onClick={onSettings} title="设置">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </button>
          <button className="sb-foot-btn" onClick={toggleTheme} title={mode === "light" ? "亮色" : mode === "dark" ? "暗色" : "自动"}>
            {mode === "light" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            ) : mode === "dark" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="11" fontWeight="700" fontFamily="system-ui">A</text></svg>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
