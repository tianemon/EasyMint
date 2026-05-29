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
    collapsedLeft ? "24px" : `${leftWidth}px`,
    collapsedLeft ? "0px" : "4px",
    "1fr",
    collapsedRight ? "0px" : "4px",
    collapsedRight ? "24px" : `${rightWidth}px`,
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

      {/* Grid: sidebar | left panel | handle | center | handle | right panel */}
      <div
        className="flex-1 min-h-0 relative grid-panels"
        style={{ display: "grid", gridTemplateColumns: gridColumns }}
      >
        {/* Column 1: Sidebar — 44px */}
        <LeftToolbar activePanel={activePanel} onSelect={setActivePanel} onSettings={() => setShowSettings(true)} />

        {/* Column 2: Left panel — collapsible, or peek button when collapsed */}
        {collapsedLeft ? (
          <div className="flex items-center justify-center h-full" style={{ gridColumn: "2" }}>
            <button
              className="w-5 h-12 rounded-r-md bg-surface-alt border border-border border-l-0 text-text-secondary hover:text-accent hover:bg-surface-hover transition-colors flex items-center justify-center"
              onClick={toggleLeft}
              title="展开文件面板"
            >
              ▸
            </button>
          </div>
        ) : (
          <div style={{ gridColumn: "2" }}>
            <LeftPanel
              activePanel={activePanel}
              projectPath={projectPath}
              projectId={projectId!}
              onCollapse={toggleLeft}
              onFileClick={handleFileClick}
              onSessionClick={handleSessionClick}
              onNewSession={handleNewSession}
              activeSessionId={activeSessionId}
            />
          </div>
        )}

        {/* Column 3: Left drag handle */}
        {!collapsedLeft && <div style={{ gridColumn: "3" }}><DragHandle onDrag={handleLeftDrag} /></div>}

        {/* Column 4: Center area */}
        <div style={{ gridColumn: "4" }} className="flex flex-col min-w-0 overflow-hidden">
          {/* Tab bar */}
          <TabBar />

          {/* Content: fills remaining space */}
          <div className="flex-1 min-h-0">{renderTabContent()}</div>

        </div>

        {/* Column 5: Right drag handle */}
        {!collapsedRight && <div style={{ gridColumn: "5" }}><DragHandle onDrag={handleRightDrag} /></div>}

        {/* Column 6: Right panel — collapsible, or peek button when collapsed */}
        {collapsedRight ? (
          <div className="flex items-center justify-center h-full" style={{ gridColumn: "6" }}>
            <button
              className="w-5 h-12 rounded-l-md bg-surface-alt border border-border border-r-0 text-text-secondary hover:text-accent hover:bg-surface-hover transition-colors flex items-center justify-center"
              onClick={toggleRight}
              title="展开任务面板"
            >
              ◂
            </button>
          </div>
        ) : (
          <div style={{ gridColumn: "6" }}>
            <RightPanel onCollapse={toggleRight} />
          </div>
        )}
      </div>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
