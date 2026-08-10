import { useState, useCallback, useEffect, useRef } from "react";
import { SessionHistory } from "./SessionHistory";
import { SessionBar } from "./SessionBar";
import { FileTreePanel } from "./FileTreePanel";
import { TaskPanel } from "./TaskPanel";
import { IssuePanel } from "./IssuePanel";
import { RunPanel } from "./RunPanel";
import { ToolboxPanel } from "./toolbox/ToolboxPanel";
import { DevicePanel } from "./device/DevicePanel";
import { useThemeStore } from "../stores/theme-store";
import { useDelegationStore } from "../stores/delegation-store";
import { readVersion, markRead } from "../lib/update-notice";

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
  onNewGroupSession?: () => void;
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
  onNewSession, onNewDesignSession, onNewGroupSession, onSessionClick, onSessionDelete,
  onFileClick, onNewProject, onOpenProject, onRenameProject,
  onSettings,
}: SidebarProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<SidebarTab>("sessions");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("tasks");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // 任务按钮呼吸灯:与任务行「绿色转圈(animate-spin)」同源——委派实时执行中(taskExecutions running)才显示
  const taskExecutions = useDelegationStore((s) => s.taskExecutions);
  const hasActiveTask = Object.values(taskExecutions).some((e) => e.status === "running");
  const [plusOpen, setPlusOpen] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const segRef = useRef<HTMLDivElement>(null);

  // 检测是否有可用更新(挂载查询 + 广播实时订阅)
  // 消费式红点:有新版本显示红点(按版本记已读);下载完成升级为「重启升级」气泡
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; downloaded: boolean } | null>(null);
  useEffect(() => {
    window.electronAPI?.app?.hasUpdate?.().then(({ hasUpdate: h, version }) => {
      if (h && version) setUpdateInfo({ version, downloaded: true });
    }).catch(() => {});
    const off = window.electronAPI?.app?.onUpdateStatus?.((data: { status: string; version?: string }) => {
      if (data.status === "available" || data.status === "downloading") {
        setUpdateInfo({ version: data.version, downloaded: false });
      } else if (data.status === "downloaded") {
        setUpdateInfo({ version: data.version, downloaded: true });
      } else if (data.status === "no-update" || data.status === "error") {
        setUpdateInfo(null);
      }
    });
    return () => { off?.(); };
  }, []);

  // 已读状态(按版本):红点 = 有版本且未读;气泡显示时红点隐藏(气泡是更强的未读提示)
  const dotUnread = updateInfo?.version != null && updateInfo.version !== readVersion("dot");
  const bubbleUnread = updateInfo?.downloaded && updateInfo.version != null && updateInfo.version !== readVersion("bubble");
  const showDot = !!dotUnread && !bubbleUnread;

  const handleSettings = () => {
    if (updateInfo?.version) {
      markRead("dot", updateInfo.version);
      markRead("bubble", updateInfo.version);
    }
    onSettings?.();
  };

  // 点击下拉菜单以外区域 → 关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (plusWrapRef.current && !plusWrapRef.current.contains(t)) setPlusOpen(false);
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
          <button className="sb-plus-btn" title="新建…" onClick={() => setPlusOpen(!plusOpen)}>
            {/* SVG 加号:精确居中(替代文字 + 的基线偏移) */}
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-3.5 h-3.5">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
          </button>
          {plusOpen && (
            <div className="sb-dropdown open">
              <button className="sb-dropdown-item" onClick={() => { setPlusOpen(false); onNewProject?.(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>
                新建项目
              </button>
              <button className="sb-dropdown-item" onClick={() => { setPlusOpen(false); onOpenProject?.(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>
                打开项目
              </button>
              <button className="sb-dropdown-item" onClick={() => { setPlusOpen(false); onRenameProject?.(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
                重命名项目
              </button>
              <div className="sb-dropdown-div" />
              <button className="sb-dropdown-item" onClick={() => { setPlusOpen(false); window.electronAPI?.window?.newWindow?.(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
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
            <SessionBar
              projectPath={projectPath}
              onSessionClick={onSessionClick}
              onNewSession={onNewSession}
              onNewDesignSession={onNewDesignSession}
              onNewGroupSession={onNewGroupSession}
              refreshKey={sessionRefreshKey}
            />
            <SessionHistory
              projectPath={projectPath}
              onSessionClick={onSessionClick}
              onSessionDelete={onSessionDelete}
              activeSessionId={activeSessionId}
              refreshKey={sessionRefreshKey}
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
      <div ref={drawerRef} className={`sb-drawer ${drawerOpen ? "open" : ""} ${drawerTab === "tasks" ? "ptr-left" : drawerTab === "runs" ? "ptr-mid" : "ptr-right"}`}>
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
            <button className={`sb-seg-btn ${drawerTab === "tasks" && drawerOpen ? "active" : ""} ${drawerTab === "tasks" ? "on" : ""} ${hasActiveTask ? "task-breathing" : ""}`} onClick={() => toggleDrawer("tasks")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>
              <span className="sb-seg-label">任务</span>
            </button>
            <button className={`sb-seg-btn ${drawerTab === "runs" && drawerOpen ? "active" : ""}`} onClick={() => toggleDrawer("runs")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              <span className="sb-seg-label">运行</span>
            </button>
            <button className={`sb-seg-btn ${drawerTab === "issues" && drawerOpen ? "active" : ""}`} onClick={() => toggleDrawer("issues")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span className="sb-seg-label">Issue</span>
            </button>
          </div>
        </div>
        <div className="sb-foot-bottom">
          <div className="relative">
            <button className={`sb-foot-btn ${showDot ? "has-dot" : ""}`} onClick={handleSettings} title="设置">
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
            {/* 下载完成 → 按钮上方气泡「重启升级」:点击直接执行安装;点设置按钮后消失 */}
            {bubbleUnread && (
              <div
                className="update-bubble"
                onClick={() => { window.electronAPI?.app?.installUpdate?.(); }}
                title="重启并升级"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
                重启升级
              </div>
            )}
          </div>
          {/* 工具箱按钮:与设置首尾对称(方案 B) */}
          <button
            className={`sb-foot-btn ${toolboxOpen ? "bg-surface-hover" : ""}`}
            onClick={() => setToolboxOpen((v) => !v)}
            title="工具箱"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
          </button>
        </div>
      </div>
      {/* 工具箱弹层:相对 sidebar 定位(底部按钮上方弹出,不受按钮容器尺寸影响) */}
      <ToolboxPanel
        open={toolboxOpen}
        onClose={() => setToolboxOpen(false)}
        onOpenDevicePanel={() => setDevicePanelOpen(true)}
      />
      {/* 设备互联浮层:fixed 覆盖整个视口 */}
      <DevicePanel open={devicePanelOpen} onClose={() => setDevicePanelOpen(false)} />
    </aside>
  );
}
