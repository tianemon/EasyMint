interface TitleBarProps {
  projectName: string;
}

export function TitleBar({ projectName }: TitleBarProps): JSX.Element {
  return (
    <div
      className="h-10 flex items-center bg-surface-alt border-b border-border shrink-0 select-none"
      style={suppressTsWebkit("drag")}
    >
      <div
        className="flex items-center gap-1.5 pl-3"
        style={suppressTsWebkit("no-drag")}
      >
        <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
        <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
        <div className="w-3 h-3 rounded-full bg-[#28c840]" />
      </div>
      <div className="flex-1 text-center text-xs text-text-secondary font-medium">
        {projectName}
      </div>
      <div className="w-[52px]" />
    </div>
  );
}

function suppressTsWebkit(value: string): React.CSSProperties {
  const out: Record<string, string> = {};
  out.WebkitAppRegion = value;
  return out as React.CSSProperties;
}
