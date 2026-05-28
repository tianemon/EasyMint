import { useState } from "react";
import { useParams } from "react-router-dom";
import { LeftToolbar } from "../components/LeftToolbar";
import { TerminalPanel } from "../components/TerminalPanel";
import { FileTreePanel } from "../components/FileTreePanel";
import { SessionHistory } from "../components/SessionHistory";
import { EditorPanel } from "../components/EditorPanel";

type ActivePanel = "editor" | "files" | "sessions" | "terminal" | "settings";

export function ProjectPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const [activePanel, setActivePanel] = useState<ActivePanel>("terminal");

  const renderCenterPanel = () => {
    switch (activePanel) {
      case "files":
        return <FileTreePanel projectId={projectId!} />;
      case "sessions":
        return <SessionHistory projectId={projectId!} />;
      default:
        return <EditorPanel />;
    }
  };

  return (
    <div className="flex h-screen">
      {/* Left toolbar */}
      <LeftToolbar activePanel={activePanel} onSelect={setActivePanel} />

      {/* Center area: editor on top, terminal on bottom */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Upper: editor / file tree / sessions */}
        <div className="flex-1 min-h-0">
          {activePanel === "terminal" ? (
            <EditorPanel />
          ) : (
            renderCenterPanel()
          )}
        </div>

        {/* Lower: terminal */}
        <div className="h-1/2 border-t border-border min-h-[200px]">
          <TerminalPanel projectId={projectId!} />
        </div>
      </div>
    </div>
  );
}
