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
import { useTaskStore, type TaskStatus } from "../stores/task-store";
import { useProjectStatusStore, type ProjectStage } from "../stores/project-status-store";
import { chatActions } from "../stores/chat-actions";
import { CONTINUE_NEXT_STEP } from "../../../shared/prompts";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";

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
  const [openProjectList, setOpenProjectList] = useState<Array<{ id: string; name: string; path: string; exists?: boolean }>>([]);
  const [windowChoiceTarget, setWindowChoiceTarget] = useState<{ id: string; sid?: string | null; init?: boolean } | null>(null);
  const [projectExists, setProjectExists] = useState(true);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameNewName, setRenameNewName] = useState("");
  const [renamePhase, setRenamePhase] = useState<"input" | "copying" | "finalizing">("input");

  // 监听重命名进度
  useEffect(() => {
    return window.electronAPI.agent.onRenameProgress(({ phase }) => {
      setRenamePhase(phase as "copying" | "finalizing");
    });
  }, []);

  // 监听会话自动命名 → 同步 Tab 标题
  useEffect(() => {
    return window.electronAPI.agent.onSessionRenamed(({ sessionId, title }) => {
      const ts = useTabStore.getState();
      const tab = ts.tabs.find((t) => t.sessionId === sessionId);
      if (tab) ts.updateTab(tab.id, { title });
    });
  }, []);

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
          setProjectExists(p.exists ?? false);
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

  // Listen for context rotation: old session archived → new tab with handoff
  useEffect(() => {
    const unsub = window.electronAPI.agent.onRotateCreate(({ oldSessionId, handoffPrompt }) => {
      // Close old tab
      const ts = useTabStore.getState();
      const oldTab = ts.tabs.find((t) => t.type === "chat" && t.sessionId === oldSessionId);
      if (oldTab) ts.closeTab(oldTab.id);

      // Create new tab — sessionId undefined so ChatPanel treats as brand-new
      const tabId = `rotate-${Date.now()}`;
      ts.openTab({ id: tabId, type: "chat" as const, title: "新会话" });
      ts.setActiveTab(tabId);

      // Auto-send the handoff prompt after ChatPanel mounts
      setTimeout(() => {
        chatActions.send(handoffPrompt);
      }, 400);
    });
    return () => unsub();
  }, [projectId]);

  // Listen for real-time task status updates from set_task_status MCP tool
  useEffect(() => {
    const unsub = window.electronAPI.agent.onTaskStatus(({ taskId, status, projectPath: eventPath }) => {
      // 守卫：只处理当前项目的事件
      if (eventPath && projectPath && eventPath !== projectPath) return;
      useTaskStore.getState().updateTask(taskId, { status: status as TaskStatus });
      // 同步刷新 project-status-store（doneCount / stage / Fishbone stepper）
      if (projectPath) useProjectStatusStore.getState().refreshAll(projectPath);
    });
    return () => unsub();
  }, [projectPath]);

  // Listen for real-time project stage updates from set_project_stage MCP tool
  useEffect(() => {
    const unsub = window.electronAPI.agent.onProjectStage(({ stage, projectPath: eventPath }) => {
      // 守卫：只处理当前项目的事件
      if (eventPath && projectPath && eventPath !== projectPath) return;
      useProjectStatusStore.getState().setStage(stage as ProjectStage);
    });
    return () => unsub();
  }, [projectPath]);

  const handleFileClick = useCallback(
    (filePath: string, fileName: string) => {
      openTab({ id: "", type: "file", title: fileName, filePath });
    },
    [openTab]
  );

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      // 若已有同 session 的 Tab，直接激活，不再重复打开
      const ts = useTabStore.getState();
      const existing = ts.tabs.find((t) => t.type === "chat" && t.sessionId === sessionId);
      if (existing) {
        ts.setActiveTab(existing.id);
        setActivePanel("chat");
        return;
      }
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
        const newStatus = (t.status || "pending") as TaskStatus;
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

  const handleRelocate = useCallback(async () => {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (!dir || !projectId) return;
    const updated = await window.electronAPI.project.update(projectId, { path: dir });
    if (updated) {
      setProjectPath(updated.path);
      setProjectName(updated.name);
      setProjectExists(updated.exists ?? false);
      document.title = `${updated.name} — EasyMint`;
      window.electronAPI.settings.setLastProject(projectId);
      refreshAll(updated.path);
    }
  }, [projectId, refreshAll]);

  const handleBrowseFolder = useCallback(async () => {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (!dir) return;
    const imported = await window.electronAPI.project.import(dir);
    setShowOpenProject(false);
    navigate(`/project/${imported.id}`);
  }, [navigate]);

  const handleRenameProject = useCallback(() => {
    setRenameNewName(projectName);
    setRenamePhase("input");
    setShowRenameDialog(true);
  }, [projectName]);

  const handleRenameConfirm = useCallback(async () => {
    const trimmed = renameNewName.trim();
    if (!trimmed || trimmed === projectName || !projectPath) {
      setShowRenameDialog(false);
      return;
    }
    // 二次确认：提醒用户 EM 将关闭
    if (!window.confirm(`重命名将关闭 EasyMint。\n\n新名称: ${trimmed}\n新路径: ${projectPath.replace(/[^/]+$/, trimmed)}\n\n请确保所有工作已保存。`)) {
      return;
    }
    setRenamePhase("copying");
    window.electronAPI.project.renameExec(projectPath, trimmed).then((res) => {
      if (!res.ok) {
        alert(res.error || "重命名失败");
        setRenamePhase("input");
      }
    });
  }, [renameNewName, projectName, projectPath]);

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

  const _activeTab = tabs.find((t) => t.id === activeTabId);

  const renderTabContent = () => {
    return (
      <>
        {tabs.length === 0 && <EditorPanel />}
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          if (tab.type === "chat") {
            return (
              <div key={tab.id} className="absolute inset-0" style={{ display: isActive ? undefined : "none" }}>
                <ChatPanel
                  projectPath={projectPath}
                  sessionId={tab.sessionId}
                  onSessionCreated={(sid) => {
                    useTabStore.getState().updateTab(tab.id, { sessionId: sid, title: "新会话" });
                    setActiveSessionId(sid);
                    setSessionRefreshKey((k) => k + 1);
                  }}
                  onActivity={() => { setSessionRefreshKey((k) => k + 1); }}
                  onNewProject={() => setShowNewProject(true)}
                />
              </div>
            );
          }
          if (tab.type === "file") {
            return (
              <div key={tab.id} className="absolute inset-0" style={{ display: isActive ? undefined : "none" }}>
                <EditorPanel filePath={tab.filePath} fileName={tab.title} />
              </div>
            );
          }
          return null;
        })}
      </>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Title bar — 40px macOS-style */}
      <TitleBar
        projectName={projectName}
        projectDeleted={!projectExists && !!projectId}
        onRelocate={!projectExists && !!projectId ? handleRelocate : undefined}
      />

      {/* Grid + floating handles */}
      <div
        className="flex-1 min-h-0 grid-panels overflow-hidden relative"
        style={{ display: "grid", gridTemplateColumns: gridColumns, gridTemplateRows: "100%", gap: 0, background: "var(--color-surface)" }}
      >
        <LeftToolbar
          activePanel={activePanel}
          onSelect={setActivePanel}
          onSettings={() => setShowSettings(true)}
          onNewProject={() => setShowNewProject(true)}
          onOpenProject={handleOpenProject}
          onRenameProject={projectId && projectExists ? handleRenameProject : undefined}
        />

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
          <TaskPanel projectPath={projectPath} onCollapse={toggleRight} onMintClick={async () => {
            // 无项目 → 打开新建项目弹窗
            if (!projectPath) {
              setShowNewProject(true);
              return;
            }
            const ts = useTabStore.getState();

            // 优先：已有 Mint 会话 Tab → 激活
            const existingChat = ts.tabs.find((t) => t.type === "chat" && t.sessionId);
            if (existingChat) {
              ts.setActiveTab(existingChat.id);
              setActivePanel("chat");
              setTimeout(() => chatActions.send(CONTINUE_NEXT_STEP), 200);
              return;
            }

            // 其次：从会话列表中拉取第一个会话
            const sessions = await window.electronAPI.conv.list(projectPath || getWorkspaceDir());
            if (sessions.length > 0) {
              const first = sessions[0]!;
              ts.openTab({ id: "", type: "chat" as const, title: first.title, sessionId: first.sessionId });
              ts.setActiveTab(ts.tabs[ts.tabs.length - 1]!.id);
              setActivePanel("chat");
              return;
            }

            // 最后：全新会话
            const tabId = `mint-${Date.now()}`;
            ts.openTab({ id: tabId, type: "chat" as const, title: "新会话" });
            setActivePanel("chat");
            setTimeout(() => chatActions.send(CONTINUE_NEXT_STEP), 200);
          }} />
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

      {/* Rename Project Dialog */}
      {showRenameDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={renamePhase === "input" ? () => setShowRenameDialog(false) : undefined}>
          <div className="bg-surface-elevated rounded-xl border border-border shadow-2xl w-[400px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-base font-semibold text-text-primary">重命名项目</h2>
              {renamePhase === "input" && (
                <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={() => setShowRenameDialog(false)}>✕</button>
              )}
            </div>

            {renamePhase === "input" ? (
              <>
                <p className="px-5 pb-3 text-xs text-text-secondary">
                  重命名将关闭 EasyMint，把项目完整复制到新位置，验证通过后清理旧数据，然后自动重启。
                </p>
                <div className="px-5 pb-4">
                  <label className="block text-xs text-text-secondary mb-1.5">新名称</label>
                  <input
                    className="w-full input"
                    value={renameNewName}
                    onChange={(e) => setRenameNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRenameConfirm(); if (e.key === "Escape") setShowRenameDialog(false); }}
                    autoFocus
                    placeholder="输入新名称"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 px-5 pb-4">
                  <button
                    className="px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover rounded-lg transition-colors"
                    onClick={() => setShowRenameDialog(false)}
                  >
                    取消
                  </button>
                  <button
                    className="px-4 py-2 text-sm bg-accent text-text-inverse rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-40"
                    disabled={!renameNewName.trim() || renameNewName.trim() === projectName}
                    onClick={handleRenameConfirm}
                  >
                    确认重命名
                  </button>
                </div>
              </>
            ) : (
              <div className="px-5 pb-5 text-center">
                <div className="mx-auto w-8 h-8 mb-3">
                  <svg className="animate-spin w-8 h-8 text-accent" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </div>
                <p className="text-sm text-text-primary font-medium mb-1">
                  {renamePhase === "copying" ? "正在复制项目文件…" : "正在收尾…"}
                </p>
                <p className="text-xs text-text-secondary">
                  {renamePhase === "copying" ? "文件较多时可能需要一些时间" : "即将重启 EasyMint"}
                </p>
                <div className="mt-4 w-full bg-surface-alt rounded-full h-1.5 overflow-hidden">
                  <div className="h-full bg-accent rounded-full animate-progress-indeterminate" style={{ width: "40%" }} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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
                        if (projectId && projectId !== p.id) {
                          setWindowChoiceTarget({ id: p.id });
                        } else {
                          navigate(`/project/${p.id}`);
                        }
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-medium ${p.id === projectId ? "text-accent" : "text-text-primary"}`}>{p.name}</span>
                        {p.exists === false && <span className="text-[10px] text-danger">目录已删除</span>}
                      </div>
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
              {/* 浏览文件夹入口 */}
              <div className="border-t border-border mt-2 pt-2">
                <button
                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-text-secondary hover:bg-surface-hover transition-colors flex items-center gap-2"
                  onClick={handleBrowseFolder}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
                    <path d="M2 4a1 1 0 011-1h3l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/>
                  </svg>
                  浏览文件夹…
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 窗口选择弹窗：打开/新建项目时，让用户选在当前窗口还是新窗口 */}
      {windowChoiceTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
          <div className="bg-surface-elevated rounded-xl border border-border shadow-2xl p-6 w-[400px] flex flex-col gap-4">
            <p className="text-sm text-text-primary font-medium">当前窗口已打开项目，要在哪里打开？</p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-5 py-2 rounded-lg border border-border text-text-secondary text-sm hover:bg-surface-hover transition-colors"
                onClick={async () => {
                  const t = windowChoiceTarget;
                  setWindowChoiceTarget(null);
                  await window.electronAPI.window.openProject(t.id, t.sid ?? undefined, t.init ?? false);
                }}
              >
                在新窗口打开
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-accent text-text-inverse text-sm hover:bg-accent-hover transition-colors font-medium"
                onClick={() => {
                  const t = windowChoiceTarget;
                  setWindowChoiceTarget(null);
                  const params = new URLSearchParams();
                  if (t.sid) params.set("session", t.sid);
                  if (t.init) params.set("init", "1");
                  const qs = params.toString();
                  navigate(`/project/${t.id}${qs ? `?${qs}` : ""}`);
                }}
              >
                在当前窗口打开
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewProject && (
        <NewProjectDialog
          onClose={() => setShowNewProject(false)}
          onCreated={(project, sessionId) => {
            setShowNewProject(false);
            if (projectId && projectId !== project.id) {
              setWindowChoiceTarget({ id: project.id, sid: sessionId, init: true });
            } else {
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
