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
  onSessionDelete?: (convId: string) => void;
  activeSessionId?: string;
  sessionRefreshKey?: number;
}

export function LeftPanel({
  activePanel,
  projectPath,
  projectId,
  onCollapse,
  onFileClick,
  onSessionClick,
  onNewSession,
  onSessionDelete,
  activeSessionId,
  sessionRefreshKey,
}: LeftPanelProps): JSX.Element {
  const isFiles = activePanel === "files" || activePanel === "editor";
  const title = isFiles ? "项目文件" : "会话";
  const [collapseAllKey, setCollapseAllKey] = useState(0);

  return (
    <div className="flex flex-col min-w-0 bg-surface">
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
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="M7.5 3l-3 3 3 3"/></svg>
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
            projectPath={projectPath}
            onSessionClick={onSessionClick}
            onNewSession={onNewSession}
            onSessionDelete={onSessionDelete}
            activeSessionId={activeSessionId}
            refreshKey={sessionRefreshKey}
          />
        )}
      </div>
    </div>
  );
}
