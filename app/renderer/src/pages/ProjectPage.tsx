import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { LeftToolbar } from "../components/LeftToolbar";
import { FileTreePanel } from "../components/FileTreePanel";
import { SessionHistory } from "../components/SessionHistory";
import { EditorPanel } from "../components/EditorPanel";
import { ChatPanel } from "../components/ChatPanel";
import { StreamPanel } from "../components/StreamPanel";

export type ActivePanel = "editor" | "files" | "sessions" | "chat" | "settings";

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const [activePanel, setActivePanel] = useState<ActivePanel>("editor");
  const [projectPath, setProjectPath] = useState("");

  useEffect(() => {
    if (projectId) {
      window.electronAPI.project.get(projectId).then((p) => {
        if (p) setProjectPath(p.path);
      });
    }
  }, [projectId]);

  const renderCenterPanel = () => {
    switch (activePanel) {
      case "files":
        return <FileTreePanel projectPath={projectPath} />;
      case "sessions":
        return <SessionHistory projectId={projectId!} />;
      case "chat":
        return <ChatPanel projectPath={projectPath} />;
      default:
        return <EditorPanel />;
    }
  };

  return (
    <div className="flex h-screen">
      {/* Left toolbar — fixed 48px */}
      <LeftToolbar activePanel={activePanel} onSelect={setActivePanel} />

      {/* Center area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Upper: editor area (50%) */}
        <div className="flex-1 min-h-0">
          {renderCenterPanel()}
        </div>

        {/* Lower: stream output panel (50%, min 200px) */}
        <div className="flex-1 min-h-[200px] border-t border-border">
          <StreamPanel />
        </div>

        {/* Bottom action bar */}
        <div className="h-12 border-t border-border flex items-center justify-end px-4 gap-3 bg-surface-alt shrink-0">
          <button className="px-4 py-1.5 rounded-lg bg-accent text-black text-sm font-medium hover:bg-accent-hover transition-colors">
            启动开发
          </button>
          <button className="px-4 py-1.5 rounded-lg border border-border text-text-primary text-sm hover:bg-surface-hover transition-colors">
            启动评估
          </button>
        </div>
      </div>

      {/* Right panel — reserved for future use */}
    </div>
  );
}
