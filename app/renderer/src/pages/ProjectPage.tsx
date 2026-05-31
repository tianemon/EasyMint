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

export type ActivePanel = "editor" | "files" | "sessions" | "chat";

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [activePanel, setActivePanel] = useState<ActivePanel>("editor");
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
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);

  useEffect(() => {
    // 切换项目时清空标签页和任务
    useTabStore.getState().clearTabs();
    useTaskStore.getState().clearTasks();
    if (projectId) {
      window.electronAPI.project.get(projectId).then((p) => {
        if (p) {
          setProjectPath(p.path);
          setProjectName(p.name);
          document.title = `${p.name} — EasyMint`;
          window.electronAPI.settings.setLastProject(projectId);
          // 从 task.json 同步任务到面板
          window.electronAPI.task.read(p.path).then((result) => {
            const ts = useTaskStore.getState();
            result.tasks.forEach((t) => {
              const existing = ts.tasks.find((x) => x.id === t.id);
              if (!existing) {
                ts.addTask({
                  id: t.id,
                  title: t.title,
                  description: t.description,
                  command: t.command,
                  status: t.passes ? "done" : "pending",
                });
              }
            });
          });
          // DEBUG: mock tasks for timeline testing
          const ts = useTaskStore.getState();
          if (ts.tasks.length === 0) {
            const now = Date.now();
            const m = (n: number) => now - n * 60000;

            const doAdd = (id: string, title: string, desc: string, cmd: string, status: TaskItem["status"], completedMin: number, out?: string[]) => {
              ts.addTask({ id, title, description: desc, command: cmd, status });
              if (completedMin || out) {
                useTaskStore.setState((s) => ({
                  tasks: s.tasks.map((t) => {
                    if (t.id !== id) return t;
                    const u = { ...t };
                    if (completedMin) u.completedAt = m(completedMin);
                    if (out) u.output = out;
                    return u;
                  }),
                }));
              }
            };

            // Done — spreading across last 3 hours
            doAdd("t01", "初始化开发环境", "填充 init.sh 并安装项目依赖", "bash init.sh", "done", 180, ["node -v → v22.0.0", "npm install → 134 packages", "环境就绪"]);
            doAdd("t02", "创建数据库表结构", "根据架构设计创建 users / posts / comments 表", "echo 'migrate'", "done", 165, ["CREATE TABLE users", "CREATE TABLE posts", "CREATE TABLE comments", "迁移完成"]);
            doAdd("t03", "搭建首页布局", "响应式三栏布局 + 顶部导航栏", "echo 'layout'", "done", 150, ["layout 组件已创建", "响应式断点已配置 sm/md/lg/xl"]);
            doAdd("t04", "实现用户注册接口", "邮箱注册 + 密码加密 + 邮箱验证", "echo 'register'", "done", 135, ["POST /api/auth/register → 201", "bcrypt 加密正常", "验证邮件已发送"]);
            doAdd("t05", "设计全局 CSS 变量体系", "色彩 / 间距 / 字体 / 阴影统一管理", "echo 'css vars'", "done", 120, [":root 变量文件已创建", "替换了 47 处硬编码色值"]);
            doAdd("t06", "编写 README 文档", "项目介绍 + 技术栈 + 本地运行指南", "echo 'readme'", "done", 105, ["README.md 已更新"]);
            doAdd("t07", "配置 ESLint + Prettier", "统一代码风格，pre-commit 自动格式化", "echo 'lint'", "done", 90, [".eslintrc 配置完成", "prettier 集成", "pre-commit hook 已添加"]);
            doAdd("t08", "实现用户登录页面", "邮箱密码登录 + JWT token 存储", "echo 'login'", "failed", 75, ["登录表单 UI 完成", "API 调用 200", "JWT 存储到 localStorage", "测试失败: token 过期未刷新"]);
            doAdd("t09", "编写 API 接口文档", "Swagger OpenAPI 3.0 规范", "echo 'swagger'", "done", 60, ["swagger.json 已生成", "/api/docs 可访问"]);
            doAdd("t10", "实现文章列表分页", "RESTful 分页 + 无限滚动", "echo 'pagination'", "done", 45, ["GET /api/posts?page=1&size=20", "前端 IntersectionObserver", "加载更多已完成"]);
            doAdd("t11", "添加暗黑模式切换", "CSS 变量切换 + localStorage 持久化", "echo 'dark mode'", "failed", 30, ["dark 主题变量已定义", "切换按钮正常", "部分第三方组件未适配"]);
            doAdd("t12", "修复登录页面样式错乱", "移动端按钮重叠，flex 布局修正", "echo 'fix flex'", "pending", 0);
            doAdd("t13", "实现文章搜索功能", "全文搜索 + 高亮关键词", "echo 'search'", "pending", 0);
            doAdd("t14", "添加单元测试覆盖", "Jest + React Testing Library", "echo 'test'", "pending", 0);
            doAdd("t15", "优化首页加载性能", "图片懒加载 + 代码分割 + CDN", "echo 'perf'", "pending", 0);
            doAdd("t16", "部署到 Vercel", "配置环境变量 + 自定义域名", "echo 'deploy'", "pending", 0);
            doAdd("t17", "实现评论功能", "嵌套评论 + 实时通知", "echo 'comments'", "pending", 0);
            doAdd("t18", "添加国际化 i18n", "中英文切换 + 语言检测", "echo 'i18n'", "pending", 0);
          }
          // 如果 URL 带有 session 参数，自动打开该会话
          const params = new URLSearchParams(location.search);
          const urlSessionId = params.get("session");
          if (urlSessionId) {
            setCurrentSessionId(urlSessionId);
            setActiveSessionId(urlSessionId);
            // 切换到聊天面板并打开此会话 tab
            setActivePanel("chat");
            openTab({ id: urlSessionId, type: "chat", title: "新项目", sessionId: urlSessionId });
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
      setCurrentSessionId(sessionId);
      openTab({ id: "", type: "chat", title: "对话", sessionId });
    },
    [openTab]
  );

  const handleNewSession = useCallback(() => {
    const tabId = `new-${Date.now()}`;
    setCurrentSessionId(undefined);
    openTab({ id: tabId, type: "chat" as const, title: "新会话", sessionId: tabId });
  }, [openTab]);

  const handleSessionDelete = useCallback((sessionId: string) => {
    if (activeSessionId === sessionId) setActiveSessionId(undefined);
    closeTab(sessionId);
  }, [activeSessionId, closeTab]);

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
            sessionId={currentSessionId}
            onSessionCreated={(sid) => { setCurrentSessionId(sid); setSessionRefreshKey((k) => k + 1); }}
            onActivity={() => setSessionRefreshKey((k) => k + 1)}
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
            <button className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-5 h-12 rounded-r-md bg-surface-alt border border-border border-l-0 text-text-secondary hover:text-accent transition-colors" onClick={toggleLeft} title="展开文件面板">▸</button>
          )}
          <TabBar />
          <div className="flex-1 min-h-0 relative">{renderTabContent()}</div>
          {collapsedRight && (
            <button className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-5 h-12 rounded-l-md bg-surface-alt border border-border border-r-0 text-text-secondary hover:text-accent transition-colors" onClick={toggleRight} title="展开任务面板">◂</button>
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
          <div className="bg-white rounded-xl border border-border shadow-2xl w-[420px] max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
              <h2 className="text-base font-semibold text-text-primary">打开项目</h2>
              <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={() => setShowOpenProject(false)}>✕</button>
            </div>
            <p className="px-5 pb-2 text-xs text-text-secondary">选择一个项目，在当前窗口打开。</p>
            <div className="overflow-y-auto flex-1 px-3 pb-3">
              {openProjectList.length === 0 ? (
                <p className="text-xs text-text-secondary text-center py-8">暂无项目，创建第一个吧。</p>
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
                      className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 text-[11px]"
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
              const query = sessionId ? `?session=${sessionId}` : "";
              navigate(`/project/${project.id}${query}`);
            }
          }}
        />
      )}
    </div>
  );
}
