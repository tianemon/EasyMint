import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { LeftToolbar } from "../components/LeftToolbar";
import { LeftPanel } from "../components/LeftPanel";
import { RightPanel } from "../components/RightPanel";
import { EditorPanel } from "../components/EditorPanel";
import { ChatPanel } from "../components/ChatPanel";
import { SettingsDialog } from "../components/SettingsDialog";
import { TabBar } from "../components/TabBar";
import { DragHandle } from "../components/DragHandle";
import { TitleBar } from "../components/TitleBar";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useTabStore } from "../stores/tab-store";

export type ActivePanel = "editor" | "files" | "sessions" | "chat";

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const [activePanel, setActivePanel] = useState<ActivePanel>("editor");
  const [showSettings, setShowSettings] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("EasyMint");

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

  const { tabs, activeTabId, openTab } = useTabStore();

  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();

  useEffect(() => {
    if (projectId) {
      window.electronAPI.project.get(projectId).then((p) => {
        if (p) {
          setProjectPath(p.path);
          setProjectName(p.name);
        }
      });
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
      openTab({ id: "", type: "chat", title: "对话", sessionId });
    },
    [openTab]
  );

  const handleNewSession = useCallback(() => {
    const pid = projectId || "default";
    const tab = { id: `new-${Date.now()}`, type: "chat" as const, title: `新会话`, sessionId: `sess-${Date.now()}` };
    openTab(tab);
    if (window.electronAPI.session?.create) {
      window.electronAPI.session.create(pid, "新会话").catch(() => {});
    }
  }, [projectId, openTab]);

  const handleChatFirstMessage = useCallback(() => {
    // Tab title already set, no action needed on first message
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
            onSendFirstMessage={handleChatFirstMessage}
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
        style={{ display: "grid", gridTemplateColumns: gridColumns, gap: 0, background: "var(--color-surface)" }}
      >
        <LeftToolbar activePanel={activePanel} onSelect={setActivePanel} onSettings={() => setShowSettings(true)} />

        {collapsedLeft ? <div /> : (
          <LeftPanel activePanel={activePanel} projectPath={projectPath} projectId={projectId!} onCollapse={toggleLeft} onFileClick={handleFileClick} onSessionClick={handleSessionClick} onNewSession={handleNewSession} activeSessionId={activeSessionId} />
        )}

        <div className="flex flex-col min-w-0 overflow-hidden relative">
          {collapsedLeft && (
            <button className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-5 h-12 rounded-r-md bg-surface-alt border border-border border-l-0 text-text-secondary hover:text-accent transition-colors" onClick={toggleLeft} title="展开文件面板">▸</button>
          )}
          <TabBar />
          <div className="flex-1 min-h-0">{renderTabContent()}</div>
          {collapsedRight && (
            <button className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-5 h-12 rounded-l-md bg-surface-alt border border-border border-r-0 text-text-secondary hover:text-accent transition-colors" onClick={toggleRight} title="展开任务面板">◂</button>
          )}
        </div>

        {collapsedRight ? <div /> : <RightPanel onCollapse={toggleRight} />}

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
    </div>
  );
}
