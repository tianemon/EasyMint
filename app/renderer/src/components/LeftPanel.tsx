import { useState } from "react";
import { FileTreePanel } from "./FileTreePanel";
import { SessionHistory } from "./SessionHistory";
import type { ActivePanel } from "../pages/ProjectPage";

interface LeftPanelProps {
  activePanel: ActivePanel;
  projectPath: string;
  projectId: string;
  onCollapse: () => void;
  onFileClick?: (filePath: string, fileName: string) => void;
  onSessionClick?: (sessionId: string) => void;
  onNewSession?: () => void;
  activeSessionId?: string;
}

export function LeftPanel({
  activePanel,
  projectPath,
  projectId,
  onCollapse,
  onFileClick,
  onSessionClick,
  onNewSession,
  activeSessionId,
}: LeftPanelProps): JSX.Element {
  const isFiles = activePanel === "files" || activePanel === "editor";
  const title = isFiles ? "项目文件" : "会话";
  const [collapseAllKey, setCollapseAllKey] = useState(0);

  return (
    <div className="flex flex-col min-w-0 bg-surface border-r border-border">
      {/* Panel header */}
      <div className="h-9 flex items-center justify-between px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">{title}</span>
        <div className="flex items-center gap-1">
          {isFiles && (
            <>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
                onClick={() => setCollapseAllKey((k) => k + 1)}
                title="折叠全部"
              >
                ⊟
              </button>
            </>
          )}
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
            onClick={onCollapse}
            title="收起面板"
          >
            ◀
          </button>
        </div>
      </div>

      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isFiles ? (
          <FileTreePanel
            projectPath={projectPath}
            onFileClick={onFileClick}
            collapseAllKey={collapseAllKey}
          />
        ) : (
          <SessionHistory
            projectId={projectId}
            onSessionClick={onSessionClick}
            onNewSession={onNewSession}
            activeSessionId={activeSessionId}
          />
        )}
      </div>
    </div>
  );
}
