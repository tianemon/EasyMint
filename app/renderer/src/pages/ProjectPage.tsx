import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { TabBar } from "../components/TabBar";
import { EditorPanel } from "../components/EditorPanel";
import { ChatPanel } from "../components/ChatPanel";
import { SettingsDialog, type SettingsTab } from "../components/SettingsDialog";
import { NewProjectDialog } from "../components/NewProjectDialog";
import { GroupComposerDialog } from "../components/GroupComposerDialog";
import { useProcessStore } from "../stores/process-store";
import { useTabStore } from "../stores/tab-store";
import { useTaskStore, type TaskStatus } from "../stores/task-store";
import { useProjectStatusStore } from "../stores/project-status-store";
import { getWorkspaceDir } from "../lib/getWorkspaceDir";

export type ActivePanel = "editor" | "files" | "sessions" | "chat";

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [showNewProject, setShowNewProject] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("");
  const [showOpenProject, setShowOpenProject] = useState(false);
  const [showGroupComposer, setShowGroupComposer] = useState(false);
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

  // 监听新会话的 sessionId → 更新 Tab，使历史列表点击能复用而非重复打开
  useEffect(() => {
    return window.electronAPI.agent.onChatSession(({ sessionId }) => {
      const ts = useTabStore.getState();
      // 找到第一个没有 sessionId 的 chat tab（最近新建的）
      const tab = ts.tabs.find((t) => t.type === "chat" && !t.sessionId);
      if (tab) {
        ts.updateTab(tab.id, { sessionId });
        setActiveSessionId(sessionId);
      }
    });
  }, []);

  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const openTab = useTabStore((s) => s.openTab);
  const closeTab = useTabStore((s) => s.closeTab);

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
            openTab({ id: urlSessionId, type: "chat", title: "新项目", sessionId: urlSessionId, isNewProject });
          }
        }
      });
    } else {
      document.title = "EasyMint";
    }
  }, [projectId]);

  // Listen for context rotation: old session archived → open new tab bound to new session.
  // 接力消息（handoffPrompt）已由主进程 promptAndBridge 直接发送到新会话，
  // 这里只需打开 tab，ChatPanel 挂载时自动加载新会话历史。
  useEffect(() => {
    const unsub = window.electronAPI.agent.onContextRotated(({ sessionId }) => {
      const ts = useTabStore.getState();
      // 关闭当前激活的 chat tab（轮转发生在当前会话）
      const activeTab = ts.tabs.find((t) => t.type === "chat" && t.id === ts.activeTabId);
      if (activeTab) ts.closeTab(activeTab.id);

      // 打开绑定新会话的 tab
      const tabId = `rotate-${Date.now()}`;
      ts.openTab({ id: tabId, type: "chat" as const, title: "新会话", sessionId });
      ts.setActiveTab(tabId);
      setActiveSessionId(sessionId);
    });
    return () => unsub();
  }, [projectId]);

  // Listen for real-time task status updates from set_task_status MCP tool
  useEffect(() => {
    const unsub = window.electronAPI.agent.onTaskStatus(({ status, projectPath: eventPath }) => {
      if (eventPath && projectPath && eventPath !== projectPath) return;
      if (projectPath) {
        window.electronAPI.task.read(projectPath).then(function(r) {
          const ts = useTaskStore.getState();
          ts.clearTasks();
          r.tasks.filter(function(t) { return !t.title.includes("{{"); }).forEach(function(t) {
            ts.addTask({ id: t.id, title: t.title, description: t.description, command: t.command, status: (t.status || "pending") as TaskStatus });
          });
          useProjectStatusStore.getState().refreshAll(projectPath);
          if (status === "done") useProcessStore.getState().detect(projectPath);
        });
      }
    });
    return () => unsub();
  }, [projectPath]);

  // 项目切换时检测可运行程序（开启软件/打开项目自动检测）
  useEffect(() => {
    if (projectPath) useProcessStore.getState().detect(projectPath);
  }, [projectPath]);

  // Mint-D 生成原型后自动打开编辑器
  useEffect(() => {
    const unsub = window.electronAPI.editor.onOpenPrototype(({ projectPath: eventPath }) => {
      if (!eventPath) return;
      const filePath = eventPath + "/prototype/index.html";
      window.electronAPI.editor.open(filePath);
    });
    return () => unsub();
  }, []);

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

  const handleNewDesignSession = useCallback(() => {
    const tabId = `design-${Date.now()}`;
    openTab({ id: tabId, type: "chat" as const, title: "新建设计", isDesigner: true });
  }, [openTab]);

  // 群聊会话(需求 4):打开群聊创建弹窗
  const handleNewGroupSession = useCallback(() => {
    setShowGroupComposer(true);
  }, []);

  const handleGroupCreated = useCallback((g: { groupId: string; chatId: string; title: string }) => {
    setShowGroupComposer(false);
    openTab({ id: `group-${Date.now()}`, type: "group" as const, groupId: g.groupId, title: g.title });
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

  // 删除确认弹窗：项目会移到系统回收站/废纸篓（主进程 shell.trashItem）
  const [deleteTarget, setDeleteTarget] = useState<{ id: string } | null>(null);
  const handleDeleteProject = useCallback((e: React.MouseEvent, projectIdToDelete: string) => {
    e.stopPropagation();
    setDeleteTarget({ id: projectIdToDelete });
  }, []);
  const confirmDeleteProject = useCallback(async () => {
    if (!deleteTarget) return;
    await window.electronAPI.project.delete(deleteTarget.id);
    setOpenProjectList((prev) => prev.filter((p) => p.id !== deleteTarget!.id));
    setDeleteTarget(null);
  }, [deleteTarget]);

  const handleBrowseFolder = useCallback(async () => {
    const dir = await window.electronAPI.dialog.openDirectory();
    if (!dir) return;
    const imported = await window.electronAPI.project.import(dir);
    setShowOpenProject(false);
    // 与列表点击一致：当前已打开项目时提示窗口选择
    if (projectId && projectId !== imported.id) {
      setWindowChoiceTarget({ id: imported.id });
    } else {
      navigate(`/project/${imported.id}`);
    }
  }, [navigate, projectId]);

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

  const renderTabContent = () => {
    return (
      <>
        {tabs.length === 0 && <EditorPanel />}
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          if (tab.type === "chat") {
            return (
              <div key={tab.id} className="absolute inset-0 transition-opacity duration-200" style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}>
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
          if (tab.type === "group") {
            return (
              <div key={tab.id} className="absolute inset-0 transition-opacity duration-200" style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}>
                <ChatPanel
                  projectPath={projectPath}
                  groupId={tab.groupId}
                  onActivity={() => { setSessionRefreshKey((k) => k + 1); }}
                />
              </div>
            );
          }
          if (tab.type === "file") {
            return (
              <div key={tab.id} className="absolute inset-0 transition-opacity duration-200" style={{ opacity: isActive ? 1 : 0, pointerEvents: isActive ? "auto" : "none" }}>
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
    <div className="shell-v3">
      <Sidebar
        projectPath={projectPath}
        projectId={projectId!}
        projectName={projectName}
        projectExists={projectExists}
        activeSessionId={activeSessionId}
        sessionRefreshKey={sessionRefreshKey}
        onNewSession={handleNewSession}
        onNewDesignSession={handleNewDesignSession}
        onNewGroupSession={handleNewGroupSession}
        onSessionClick={handleSessionClick}
        onSessionDelete={handleSessionDelete}
        onFileClick={handleFileClick}
        onNewProject={() => setShowNewProject(true)}
        onOpenProject={handleOpenProject}
        onRenameProject={projectId && projectExists ? handleRenameProject : undefined}
        onSettings={() => { setSettingsTab(undefined); setShowSettings(true); }}
      />

      <main className="main-area">
        <TabBar />
        <div className="flex-1 min-h-0 relative">{renderTabContent()}</div>
      </main>

      <SettingsDialog open={showSettings} onClose={() => { setShowSettings(false); setSettingsTab(undefined); }} initialTab={settingsTab} />

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
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors mb-0.5 ${p.id === projectId ? "bg-accent-bg" : "hover:bg-surface-hover"}`}
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

      {/* 删除项目确认弹窗：与窗口选择弹窗同风格 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
          <div className="bg-surface-elevated rounded-xl border border-border shadow-2xl p-6 w-[400px] flex flex-col gap-4">
            <p className="text-sm text-text-primary font-medium">确认删除该项目吗？</p>
            <p className="text-xs text-text-secondary">（移动到{window.electronAPI?.platform === "darwin" ? "废纸篓" : "回收站"}）</p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-5 py-2 rounded-lg border border-border text-text-secondary text-sm hover:bg-surface-hover transition-colors"
                onClick={() => setDeleteTarget(null)}
              >
                取消
              </button>
              <button
                className="px-5 py-2 rounded-lg bg-danger text-white text-sm hover:opacity-90 transition-opacity font-medium"
                onClick={confirmDeleteProject}
              >
                删除
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

      {showGroupComposer && (
        <GroupComposerDialog
          projectPath={projectPath}
          onClose={() => setShowGroupComposer(false)}
          onCreated={handleGroupCreated}
        />
      )}
    </div>
  );
}
