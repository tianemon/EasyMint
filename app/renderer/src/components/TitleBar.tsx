interface TitleBarProps {
  projectName: string;
}

export function TitleBar({ projectName }: TitleBarProps): JSX.Element {
  return (
    <div
      className="h-10 flex items-center bg-surface-alt border-b border-border shrink-0 select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Traffic light spacer — leaves room for macOS window controls */}
      <div className="w-[72px] shrink-0" />
      <div className="flex-1 text-center text-xs text-text-secondary font-medium">
        {projectName || "EasyMint"}
      </div>
      {/* Symmetric spacer on the right */}
      <div className="w-[72px] shrink-0" />
    </div>
  );
}
