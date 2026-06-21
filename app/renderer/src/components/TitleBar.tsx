interface TitleBarProps {
  projectName: string;
  /** 项目目录已删除时显示重定位入口 */
  projectDeleted?: boolean;
  onRelocate?: () => void;
}

export function TitleBar({ projectName, projectDeleted, onRelocate }: TitleBarProps): JSX.Element {
  return (
    <div
      className="h-10 flex items-center bg-surface-alt border-b border-border shrink-0 select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Traffic light spacer — leaves room for macOS window controls */}
      <div className="w-[72px] shrink-0" />

      <div className="flex-1 flex items-center justify-center gap-1.5 min-w-0">
        {projectDeleted ? (
          <>
            <span className="text-xs text-danger font-medium">{projectName || "EasyMint"}</span>
            {onRelocate && (
              <button
                className="text-[11px] text-accent hover:underline cursor-pointer shrink-0"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                onClick={onRelocate}
              >
                重新定位
              </button>
            )}
          </>
        ) : (
          <span className="text-xs text-text-secondary font-medium truncate">{projectName || "EasyMint"}</span>
        )}
      </div>

      {/* Symmetric spacer on the right */}
      <div className="w-[72px] shrink-0" />
    </div>
  );
}
