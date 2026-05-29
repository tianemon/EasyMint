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
    (delta: number) => setRightWidth(rightWidth + delta),
    [rightWidth, setRightWidth]
  );

  const gridColumns = [
    "44px",
    collapsedLeft ? "0px" : `${leftWidth}px`,
    collapsedLeft ? "0px" : "4px",
    "1fr",
    collapsedRight ? "0px" : "4px",
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

      {/* Grid: sidebar | left panel | handle | center | handle | right panel */}
      <div
        className="flex-1 min-h-0 relative grid-panels"
        style={{ display: "grid", gridTemplateColumns: gridColumns }}
      >
        {/* Column 1: Sidebar — 44px */}
        <LeftToolbar activePanel={activePanel} onSelect={setActivePanel} onSettings={() => setShowSettings(true)} />

        {/* Column 2: Left panel — collapsible */}
        {!collapsedLeft && (
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
        )}

        {/* Column 3: Left drag handle */}
        {!collapsedLeft && <DragHandle onDrag={handleLeftDrag} />}

        {/* Column 4: Center area */}
        <div className="flex flex-col min-w-0 overflow-hidden">
          {/* Tab bar */}
          <TabBar />

          {/* Content: fills remaining space */}
          <div className="flex-1 min-h-0">{renderTabContent()}</div>

          {/* Bottom action bar */}
          <div className="h-12 border-t border-border flex items-center justify-end px-4 gap-3 bg-surface-alt shrink-0">
            <button
              className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
              onClick={() =>
                window.electronAPI.agent.runWorker(
                  projectPath,
                  "严格按 WORKER.md 流程完成一个任务。"
                )
              }
            >
              启动开发
            </button>
            <button className="px-4 py-1.5 rounded-lg border border-border text-text-primary text-sm hover:bg-surface-hover transition-colors">
              启动评估
            </button>
          </div>
        </div>

        {/* Column 5: Right drag handle */}
        {!collapsedRight && <DragHandle onDrag={handleRightDrag} />}

        {/* Column 6: Right panel — collapsible */}
        {!collapsedRight && <RightPanel onCollapse={toggleRight} />}

        {/* Panel-peek buttons — absolutely positioned overlays */}
        {collapsedLeft && (
          <button
            className="panel-peek panel-peek-left"
            onClick={toggleLeft}
            data-tooltip="展开文件面板"
          >
            ▸
          </button>
        )}
        {collapsedRight && (
          <button
            className="panel-peek panel-peek-right"
            onClick={toggleRight}
            data-tooltip="展开任务列表"
          >
            ◂
          </button>
        )}
      </div>

      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
