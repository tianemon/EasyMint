import { FileTreePanel } from "./FileTreePanel";
import { SessionHistory } from "./SessionHistory";
import type { ActivePanel } from "../pages/ProjectPage";

interface LeftPanelProps {
  activePanel: ActivePanel;
  projectPath: string;
  projectId: string;
  onCollapse: () => void;
}

export function LeftPanel({ activePanel, projectPath, projectId, onCollapse }: LeftPanelProps): JSX.Element {
  const isFiles = activePanel === "files" || activePanel === "editor";
  const title = isFiles ? "项目文件" : "会话";

  return (
    <div className="flex flex-col min-w-0 bg-surface border-r border-border">
      {/* Panel header */}
      <div className="h-9 flex items-center justify-between px-3 border-b border-border shrink-0">
        <span className="text-xs font-medium text-text-primary">{title}</span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
          onClick={onCollapse}
          title="收起面板"
        >
          ◀
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isFiles ? (
          <FileTreePanel projectPath={projectPath} />
        ) : (
          <SessionHistory projectId={projectId} />
        )}
      </div>
    </div>
  );
}
