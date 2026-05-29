interface TitleBarProps {
  projectName: string;
}

export function TitleBar({ projectName }: TitleBarProps): JSX.Element {
  return (
    <div className="h-10 flex items-center bg-surface-alt border-b border-border shrink-0 select-none">
      <div className="flex-1 text-center text-xs text-text-secondary font-medium">
        {projectName}
      </div>
    </div>
  );
}
