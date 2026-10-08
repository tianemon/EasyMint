import { useTranslation } from "react-i18next";
import "../lib/i18n";
import { useState, useCallback, useEffect, useRef } from "react";
import { isInsideOverlay } from "../lib/overlay-stack";
import { SessionHistory } from "./SessionHistory";
import { SessionBar } from "./SessionBar";
import { FileTreePanel } from "./FileTreePanel";
import { TaskPanel } from "./TaskPanel";
import { IssuePanel } from "./IssuePanel";
import { RunPanel } from "./RunPanel";
import { ToolboxPanel } from "./toolbox/ToolboxPanel";
import { DevicePanel } from "./device/DevicePanel";
import { MobileTerminalPanel } from "./device/MobileTerminalPanel";
import { useThemeStore } from "../stores/theme-store";
import { useEnvStore, subscribeEnvReport } from "../stores/env-store";
import { readVersion, markRead } from "../lib/update-notice";

export type SidebarTab = "sessions" | "files";
type DrawerTab = "tasks" | "issues" | "runs";

interface SidebarProps {
  projectPath: string;
  projectId: string;
  projectName: string;
  projectExists: boolean;
  activeSessionId?: string;
  sessionRefreshKey?: number;
  onNewSession?: () => void;
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
  onNewSession, onSessionClick, onSessionDelete,
  onFileClick, onNewProject, onOpenProject, onRenameProject,
  onSettings,
}: SidebarProps): JSX.Element {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SidebarTab>("sessions");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("tasks");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(false);
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  // 归档恢复后自增,触发 SessionHistory 主列表刷新(受控 sessionRefreshKey 无法直接改)
  const [archivedRefresh, setArchivedRefresh] = useState(0);
  const menuWrapRef = useRef<HTMLDivElement>(null);
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
  // 环境问题（缺组件/被系统策略挡）也点亮设置按钮——语义与更新红点相反：**不因"看过"而消失**，
  // 只有探测到全部就绪才灭（没修好就消掉会让人以为已经好了）
  const envIssue = useEnvStore((s) => s.hasIssue);
  useEffect(() => subscribeEnvReport(), []);
  const showDot = (!!dotUnread && !bubbleUnread) || envIssue;

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
      if (menuWrapRef.current && !menuWrapRef.current.contains(t)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 点击面板/seg 按钮以外区域 → 收起抽屉
  // 分层检测:点击在上层弹窗内(OutputWindow/子Agent/脚本编辑/Issue 等 portal 弹窗)不关闭抽屉
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (drawerRef.current && drawerRef.current.contains(t)) return;
      if (segRef.current && segRef.current.contains(t)) return;
      if (isInsideOverlay(t)) return; // 上层弹窗内点击不关下层
      setDrawerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [drawerOpen]);

  // 抽屉底部箭头精确对齐激活按钮中心:ptr-* 类用百分比近似(按钮宽度随文字变化,
  // 如 46% 对「运行」按钮并不居中)——打开/切换/resize 时实测按钮中心覆盖箭头 left(px)
  useEffect(() => {
    if (!drawerOpen) return;
    const align = () => {
      const drawerEl = drawerRef.current;
      const btn = segRef.current?.querySelector<HTMLButtonElement>(".sb-seg-btn.active, .sb-seg-btn.on");
      const arrow = drawerEl?.querySelector<HTMLDivElement>(".sb-drawer-arrow");
      if (!drawerEl || !btn || !arrow) return;
      const dRect = drawerEl.getBoundingClientRect();
      const bRect = btn.getBoundingClientRect();
      arrow.style.left = `${bRect.left - dRect.left + bRect.width / 2 - arrow.offsetWidth / 2}px`;
    };
    align();
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, [drawerOpen, drawerTab, i18n.resolvedLanguage]);

  const mode = useThemeStore((s) => s.mode);
  const toggleTheme = useCallback(() => {
    useThemeStore.getState().toggle();
  }, []);


  const switchTab = useCallback((tab: SidebarTab) => {
    setActiveTab(tab);
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
        {/* 项目名称区域整体是可点击的「打开项目」入口（图标 + 名称同一按钮，避免两个热区做同一个动作） */}
        <button
          type="button"
          className="sb-project-name sb-project-switch"
          title={t("nav.openProject")}
          onClick={() => onOpenProject?.()}
        >
          <svg
            className="sb-project-switch-icon"
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span className="sb-project-name-clip">
            <span className="sb-project-name-inner">{!projectId ? t("nav.noWorkspace") : (projectDeleted ? t("nav.deletedProject", { name: projectName }) : projectName)}</span>
          </span>
        </button>
        <div className="sb-menu-wrap" ref={menuWrapRef}>
          <button className="sb-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
            {/* 菜单图标（lucide menu）：口径随按钮一起放大到 16px / viewBox 24 / strokeWidth 2 */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16" /><path d="M4 12h16" /><path d="M4 19h16" />
            </svg>
          </button>
          {menuOpen && (
            <div className="sb-dropdown open">
              <button className="sb-dropdown-item" onClick={() => { setMenuOpen(false); onNewProject?.(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M12 10v6"/><path d="M9 13h6"/></svg>
                {t("nav.newProject")}
              </button>
              <button className="sb-dropdown-item" onClick={() => { setMenuOpen(false); onOpenProject?.(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>
                {t("nav.openProject")}
              </button>
              <button className="sb-dropdown-item" onClick={() => { setMenuOpen(false); onRenameProject?.(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 11.5V5a2 2 0 0 1 2-2h3.9c.7 0 1.3.3 1.7.9l.8 1.2c.4.6 1 .9 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9.5"/><path d="M11.378 13.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>
                {t("nav.renameProject")}
              </button>
              <div className="sb-dropdown-div" />
              <button className="sb-dropdown-item" onClick={() => { setMenuOpen(false); window.electronAPI?.window?.newWindow?.(); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/></svg>
                {t("nav.newWindow")}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs: 会话 | 文件 */}
      <div className="sb-tabs">
        <button className={`sb-tab ${activeTab === "sessions" ? "active" : ""}`} onClick={() => switchTab("sessions")}>{t("nav.sessions")}</button>
        <button className={`sb-tab ${activeTab === "files" ? "active" : ""}`} onClick={() => switchTab("files")}>{t("nav.files")}</button>
      </div>

      {/* Content */}
      <div className="sb-content">
        {activeTab === "sessions" ? (
          <div className="sb-session-lists flex flex-col min-h-0 flex-1">
            <SessionBar
              projectPath={projectPath}
              onSessionClick={onSessionClick}
              onNewSession={onNewSession}
              refreshKey={(sessionRefreshKey ?? 0) + archivedRefresh}
              onRestored={() => setArchivedRefresh((v) => v + 1)}
            />
            <SessionHistory
              projectPath={projectPath}
              onSessionClick={onSessionClick}
              onSessionDelete={onSessionDelete}
              activeSessionId={activeSessionId}
              refreshKey={(sessionRefreshKey ?? 0) + archivedRefresh}
              onArchived={() => setArchivedRefresh((v) => v + 1)}
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
        <div className="sb-drawer-body-wrap em-glass">
          <div className="sb-drawer-body">
            {drawerTab === "tasks" && <TaskPanel onCollapse={() => setDrawerOpen(false)} />}
            {drawerTab === "issues" && <IssuePanel projectPath={projectPath} onCollapse={() => setDrawerOpen(false)} />}
            {drawerTab === "runs" && <RunPanel projectPath={projectPath} onCollapse={() => setDrawerOpen(false)} />}
          </div>
        </div>
        <div className="sb-drawer-arrow em-glass" />
      </div>

      {/* Footer */}
      <div className="sb-foot">
        <div className="sb-foot-row">
          <div className="sb-seg-control" ref={segRef}>
            <button className={`sb-seg-btn ${drawerTab === "tasks" && drawerOpen ? "active" : ""} ${drawerTab === "tasks" ? "on" : ""}`} onClick={() => toggleDrawer("tasks")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/></svg>
              <span className="sb-seg-label">{t("nav.tasks")}</span>
            </button>
            <button className={`sb-seg-btn ${drawerTab === "runs" && drawerOpen ? "active" : ""}`} onClick={() => toggleDrawer("runs")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              <span className="sb-seg-label">{t("nav.runs")}</span>
            </button>
            <button className={`sb-seg-btn ${drawerTab === "issues" && drawerOpen ? "active" : ""}`} onClick={() => toggleDrawer("issues")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span className="sb-seg-label">{t("nav.issues")}</span>
            </button>
          </div>
        </div>
        <div className="sb-foot-bottom">
          {/* 左组:设置 + 重启升级(下载完成后显示,同款图标按钮) */}
          <div className="relative inline-flex gap-1">
            <button className={`sb-foot-btn ${showDot ? "has-dot" : ""}`} onClick={handleSettings}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            </button>
            {/* 下载完成 → 「重启升级」文字按钮(比背景略亮的灰,略矮):点击直接执行安装;点设置按钮后消失 */}
            {bubbleUnread && (
              <button
                className="update-install-btn"
                onClick={() => { window.electronAPI?.app?.installUpdate?.(); }}
               
              >
                {t("nav.restartUpdate")}
              </button>
            )}
          </div>
          <div className="flex-1" />
          <button
            className={`sb-foot-btn ${toolboxOpen ? "bg-surface-hover" : ""}`}
            onClick={() => setToolboxOpen((v) => !v)}
           
          >
            <svg width="17" height="17" viewBox="0 0 256 256" fill="currentColor"><path d="M224,64H176V56a24,24,0,0,0-24-24H104A24,24,0,0,0,80,56v8H32A16,16,0,0,0,16,80V192a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V80A16,16,0,0,0,224,64ZM96,56a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96ZM224,80v32H192v-8a8,8,0,0,0-16,0v8H80v-8a8,8,0,0,0-16,0v8H32V80Zm0,112H32V128H64v8a8,8,0,0,0,16,0v-8h96v8a8,8,0,0,0,16,0v-8h32v64Z"/></svg>
          </button>
          <button className="sb-foot-btn" onClick={toggleTheme} >
            {mode === "light" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            ) : mode === "dark" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="9"/><text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" style={{ fontSize: "var(--text-11)" }} fontWeight="700" fontFamily="system-ui">A</text></svg>
            )}
          </button>
        </div>
      </div>
      {/* 工具箱弹层:相对 sidebar 定位(底部按钮上方弹出,不受按钮容器尺寸影响)。
          两个抽屉都是 fixed 全覆盖浮层,同时打开会叠在一起——开一个先关另一个,
          不依赖遮罩挡住工具箱这个隐式前提(将来加托盘/快捷键入口就不成立了) */}
      <ToolboxPanel
        open={toolboxOpen}
        onClose={() => setToolboxOpen(false)}
        onOpenMigrationPanel={() => { setMobilePanelOpen(false); setDevicePanelOpen(true); }}
        onOpenMobilePanel={() => { setDevicePanelOpen(false); setMobilePanelOpen(true); }}
      />
      {/* 项目迁移浮层:fixed 覆盖整个视口(电脑↔电脑迁移项目) */}
      <DevicePanel open={devicePanelOpen} onClose={() => setDevicePanelOpen(false)} />
      {/* 连接手机浮层:fixed 覆盖整个视口(手机扫码配对) */}
      <MobileTerminalPanel open={mobilePanelOpen} onClose={() => setMobilePanelOpen(false)} />
    </aside>
  );
}
