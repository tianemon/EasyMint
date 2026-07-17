import { useState } from "react";
import { FileTreePanel } from "./FileTreePanel";
import { SessionHistory } from "./SessionHistory";
import { DesignSessionList } from "./DesignSessionList";
import type { ActivePanel } from "../pages/ProjectPage";

interface LeftPanelProps {
  activePanel: ActivePanel;
  projectPath: string;
  projectId: string;
  onCollapse: () => void;
  onFileClick?: (filePath: string, fileName: string) => void;
  onSessionClick?: (sessionId: string) => void;
  onNewSession?: () => void;
  onNewDesignSession?: () => void;
  onSessionDelete?: (convId: string) => void;
  activeSessionId?: string;
  sessionRefreshKey?: number;
}

type SessionTab = "project" | "design";

export function LeftPanel({
  activePanel,
  projectPath,
  projectId: _projectId,
  onCollapse,
  onFileClick,
  onSessionClick,
  onNewSession,
  onNewDesignSession,
  onSessionDelete,
  activeSessionId,
  sessionRefreshKey,
}: LeftPanelProps): JSX.Element {
  const isFiles = activePanel === "files" || activePanel === "editor";
  const title = isFiles ? "项目文件" : "会话";
  const [collapseAllKey, setCollapseAllKey] = useState(0);
  const [sessionTab, setSessionTab] = useState<SessionTab>("project");

  return (
    <div className="flex flex-col min-w-0 bg-surface">
      {/* Panel header */}
      <div className="h-9 flex items-center justify-between px-3 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-text-secondary">{title}</span>
        <div className="flex items-center gap-1">
          {isFiles && (
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
              onClick={() => setCollapseAllKey((k) => k + 1)}
              title="折叠全部"
            >
              ⊟
            </button>
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
          <>
            {/* 会话分类切换 */}
            <div className="px-3 pt-2 shrink-0">
              <div className="flex items-center bg-surface-hover rounded-full p-0.5">
                <button
                  className={`flex-1 px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${sessionTab === "project" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
                  onClick={() => setSessionTab("project")}
                >项目会话</button>
                <button
                  className={`flex-1 px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${sessionTab === "design" ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
                  onClick={() => setSessionTab("design")}
                >UI 设计</button>
              </div>
            </div>

            {sessionTab === "project" ? (
              <SessionHistory
                projectPath={projectPath}
                onSessionClick={onSessionClick}
                onNewSession={onNewSession}
                onSessionDelete={onSessionDelete}
                activeSessionId={activeSessionId}
                refreshKey={sessionRefreshKey}
              />
            ) : (
              <DesignSessionList
                projectPath={projectPath}
                onSessionClick={onSessionClick}
                onNewDesignSession={onNewDesignSession}
                onSessionDelete={onSessionDelete}
                activeSessionId={activeSessionId}
                refreshKey={sessionRefreshKey}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
