import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { LeftToolbar } from "../components/LeftToolbar";
import { LeftPanel } from "../components/LeftPanel";
import { TaskPanel } from "../components/TaskPanel";
import { EditorPanel } from "../components/EditorPanel";
import { ChatPanel } from "../components/ChatPanel";
import { SettingsDialog } from "../components/SettingsDialog";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { TabBar } from "../components/TabBar";
import { DragHandle } from "../components/DragHandle";
import { TitleBar } from "../components/TitleBar";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useTabStore } from "../stores/tab-store";
import { useTaskStore } from "../stores/task-store";
import { useProjectStatusStore } from "../stores/project-status-store";
import { useSettingsStore } from "../stores/settings-store";

function getWorkspaceDir(): string {
  const base = useSettingsStore.getState().defaultProjectDir || "~/EasyMintProject";
  return `${base.replace(/\/$/, "")}/workspace/`;
}

export type ActivePanel = "editor" | "files" | "sessions" | "chat";

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [activePanel, setActivePanel] = useState<ActivePanel>("sessions");
  const [showSettings, setShowSettings] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [showOpenProject, setShowOpenProject] = useState(false);
  const [openProjectList, setOpenProjectList] = useState<Array<{ id: string; name: string; path: string }>>([]);

  const {
    collapsedLeft,
    collapsedRight,
    leftWidth,
    rightWidth,
    toggleLeft,
    toggleRight,
    setLeftWidth,
    setRightWidth,
  } = useWorkspaceStore();

  const { tabs, activeTabId, openTab, closeTab } = useTabStore();

  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

  useEffect(() => {
    // 切换项目时清空标签页和任务
    useTabStore.getState().clearTabs();
    useTaskStore.getState().clearTasks();
    useProjectStatusStore.getState().reset();
    if (projectId) {
      window.electronAPI.project.get(projectId).then((p) => {
        if (p) {
          if (!p.exists) {
            setProjectName(p.name + "（目录已删除）");
            document.title = `项目已删除 — EasyMint`;
            return;
          }
          setProjectPath(p.path);
          setProjectName(p.name);
          document.title = `${p.name} — EasyMint`;
          window.electronAPI.settings.setLastProject(projectId);
          // 加载项目开发状态 + 同步任务（集中式 refreshAll）
          refreshAll(p.path);
          // 如果 URL 带有 session 参数，自动打开该会话
          const params = new URLSearchParams(location.search);
          const urlSessionId = params.get("session");
          const isNewProject = params.get("init") === "1";
          if (urlSessionId) {
            setActiveSessionId(urlSessionId);
            // 切换到聊天面板并打开此会话 tab
            setActivePanel("chat");
            openTab({ id: urlSessionId, type: "chat", title: "新项目", sessionId: urlSessionId, isNewProject });
          }
        }
      });
    } else {
      document.title = "EasyMint";
    }
  }, [projectId]);

  const handleFileClick = useCallback(
    (filePath: string, fileName: string) => {
      openTab({ id: "", type: "file", title: fileName, filePath });
    },
    [openTab]
  );

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      window.electronAPI.conv.get(sessionId, projectPath || getWorkspaceDir()).then((info) => {
        openTab({ id: "", type: "chat", title: info?.title || "对话", sessionId });
      }).catch(() => {
        openTab({ id: "", type: "chat", title: "对话", sessionId });
      });
    },
    [openTab, projectPath]
  );

  const handleNewSession = useCallback(() => {
    const tabId = `new-${Date.now()}`;
    // sessionId undefined = ChatPanel treats as brand-new session, not resume
    openTab({ id: tabId, type: "chat" as const, title: "新会话" });
  }, [openTab]);

  const handleSessionDelete = useCallback((sessionId: string) => {
    if (activeSessionId === sessionId) setActiveSessionId(undefined);
    // Close any tab that holds this session (match by sessionId, not tab id)
    const tab = tabs.find((t) => t.type === "chat" && t.sessionId === sessionId);
    if (tab) closeTab(tab.id);
  }, [activeSessionId, closeTab, tabs]);

  // Sync tasks from task.json → taskStore, then refresh button states
  const refreshAll = useCallback((path?: string) => {
    const p = path || projectPath;
    if (!p) return;
    window.electronAPI.task.read(p).then((r) => {
      const ts = useTaskStore.getState();
      const jsonIds = new Set(r.tasks.map((t) => t.id));
      ts.tasks.forEach((t) => { if (!jsonIds.has(t.id)) ts.updateTask(t.id, { status: "pending" }); });
      const realTasks = r.tasks.filter((t) => !t.title.includes("{{"));
      realTasks.forEach((t) => {
        const existing = ts.tasks.find((x) => x.id === t.id);
        const newStatus = (t.passes ? "done" : "pending") as "done" | "pending";
        if (existing) {
          if (existing.status !== newStatus) ts.updateTask(t.id, { status: newStatus });
        } else {
          ts.addTask({ id: t.id, title: t.title, description: t.description, command: t.command, status: newStatus });
        }
      });
      // Refresh button states after task sync
      useProjectStatusStore.getState().refreshAll(p);
    }).catch((e: unknown) => { console.error("[refreshAll]", e); });
  }, [projectPath]);

  const handleOpenProject = useCallback(async () => {
    const projects = await window.electronAPI.project.list();
    setOpenProjectList(projects);
    setShowOpenProject(true);
  }, []);

  const handleDeleteProject = useCallback(async (e: React.MouseEvent, projectIdToDelete: string) => {
    e.stopPropagation();
    await window.electronAPI.project.delete(projectIdToDelete);
    setOpenProjectList((prev) => prev.filter((p) => p.id !== projectIdToDelete));
  }, []);

  const handleLeftDrag = useCallback(
    (delta: number) => setLeftWidth(leftWidth + delta),
    [leftWidth, setLeftWidth]
  );

  const handleRightDrag = useCallback(
    (delta: number) => setRightWidth(rightWidth - delta),
    [rightWidth, setRightWidth]
  );

  const gridColumns = [
    "44px",
    collapsedLeft ? "0px" : `${leftWidth}px`,
    "1fr",
    collapsedRight ? "0px" : `${rightWidth}px`,
  ].join(" ");

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const renderTabContent = () => {
    if (!activeTab) {
      return <EditorPanel />;
    }
switch (activeTab.type) {
      case "chat":
        return (
          <ChatPanel
            key={activeTab.id}
            projectPath={projectPath}
            sessionId={activeTab.sessionId}
            onSessionCreated={(sid) => {
              // Write real SDK session_id back to tab (replaces temporary new-xxx id)
              useTabStore.getState().updateTab(activeTab.id, { sessionId: sid, title: "新会话" });
              setActiveSessionId(sid);
              setSessionRefreshKey((k) => k + 1);
            }}
            onActivity={() => { setSessionRefreshKey((k) => k + 1); refreshAll(); }}
          />
        );
      case "file":
        return <EditorPanel filePath={activeTab.filePath} fileName={activeTab.title} />;
      default:
        return <EditorPanel />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Title bar — 40px macOS-style */}
      <TitleBar projectName={projectName} />

      {/* Grid + floating handles */}
      <div
        className="flex-1 min-h-0 grid-panels overflow-hidden relative"
        style={{ display: "grid", gridTemplateColumns: gridColumns, gridTemplateRows: "100%", gap: 0, background: "var(--color-surface)" }}
      >
        <LeftToolbar activePanel={activePanel} onSelect={setActivePanel} onSettings={() => setShowSettings(true)} onNewProject={() => setShowNewProject(true)} onOpenProject={handleOpenProject} />

        {collapsedLeft ? <div /> : (
          <LeftPanel activePanel={activePanel} projectPath={projectPath} projectId={projectId!} onCollapse={toggleLeft} onFileClick={handleFileClick} onSessionClick={handleSessionClick} onNewSession={handleNewSession} onSessionDelete={handleSessionDelete} activeSessionId={activeSessionId} sessionRefreshKey={sessionRefreshKey} />
        )}

        <div className="flex flex-col min-w-0 overflow-hidden relative">
          {collapsedLeft && (
            <button className="absolute -left-px top-1/2 -translate-y-1/2 z-10 w-5 h-12 rounded-r-md bg-surface-alt border border-border text-text-secondary hover:text-accent transition-colors flex items-center justify-center" onClick={toggleLeft} title="展开文件面板">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M4.5 3l3 3-3 3"/></svg>
        </button>
          )}
          <TabBar />
          <div className="flex-1 min-h-0 relative">{renderTabContent()}</div>
          {collapsedRight && (
            <button className="absolute -right-px top-1/2 -translate-y-1/2 z-10 w-5 h-12 rounded-l-md bg-surface-alt border border-border text-text-secondary hover:text-accent transition-colors flex items-center justify-center" onClick={toggleRight} title="展开任务面板">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M7.5 3l-3 3 3 3"/></svg>
        </button>
          )}
        </div>

        {collapsedRight ? <div /> : (
          <TaskPanel projectPath={projectPath} onCollapse={toggleRight} />
        )}

        {/* Handles — grid container level, absolute over all panels */}
        {!collapsedLeft && (
          <div className="absolute top-0 bottom-0 z-10" style={{ left: `calc(44px + ${leftWidth}px)` }}>
            <DragHandle onDrag={handleLeftDrag} />
          </div>
        )}
        {!collapsedRight && (
          <div className="absolute top-0 bottom-0 z-10" style={{ right: `${rightWidth}px` }}>
            <DragHandle onDrag={handleRightDrag} />
          </div>
        )}
      </div>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

      {/* Open Project Picker */}
      {showOpenProject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowOpenProject(false)}>
          <div className="bg-surface-elevated rounded-xl border border-border shadow-2xl w-[420px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
              <h2 className="text-base font-semibold text-text-primary">打开项目</h2>
              <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={() => setShowOpenProject(false)}>✕</button>
            </div>
            <p className="px-5 pb-2 text-xs text-text-secondary">选择一个项目，在当前窗口打开。</p>
            <div className="overflow-y-auto flex-1 px-3 pb-3">
              {openProjectList.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-text-secondary mb-3">暂无项目</p>
                  <button
                    className="px-4 py-2 text-sm bg-accent text-text-inverse rounded-lg hover:bg-accent-hover transition-colors"
                    onClick={() => { setShowOpenProject(false); setShowNewProject(true); }}
                  >
                    + 创建项目
                  </button>
                </div>
              ) : (
                openProjectList.map((p) => (
                  <div key={p.id} className="relative group">
                    <button
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors mb-0.5 ${p.id === projectId ? "bg-accent/10" : "hover:bg-surface-hover"}`}
                      onClick={() => {
                        setShowOpenProject(false);
                        navigate(`/project/${p.id}`);
                      }}
                    >
                      <div className={`text-sm font-medium pr-5 ${p.id === projectId ? "text-accent" : "text-text-primary"}`}>{p.name}</div>
                      <div className="text-[11px] text-text-secondary truncate">{p.path}</div>
                    </button>
                    <button
                      className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-text-secondary hover:text-danger hover:bg-danger-bg transition-colors opacity-0 group-hover:opacity-100 text-[11px]"
                      onClick={(e) => handleDeleteProject(e, p.id)}
                      title="删除记录"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {showNewProject && (
        <NewProjectDialog
          openInNewWindow={!!projectId}
          onClose={() => setShowNewProject(false)}
          onCreated={(project, sessionId) => {
            setShowNewProject(false);
            if (!projectId) {
              // 无项目时，原地跳转到新项目页面
              const params = new URLSearchParams();
              if (sessionId) params.set("session", sessionId);
              params.set("init", "1");
              navigate(`/project/${project.id}?${params.toString()}`);
            }
          }}
        />
      )}
    </div>
  );
}
