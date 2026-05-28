interface RightPanelProps {
  onCollapse: () => void;
}

export function RightPanel({ onCollapse }: RightPanelProps): JSX.Element {
  return (
    <div className="flex flex-col min-w-0 bg-surface border-l border-border">
      {/* Panel header */}
      <div className="h-9 flex items-center justify-between px-3 border-b border-border shrink-0">
        <span className="text-xs font-medium text-text-primary">任务列表</span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors text-xs"
          onClick={onCollapse}
          title="收起面板"
        >
          ▶
        </button>
      </div>

      {/* Panel content — placeholder, Task 7 will implement */}
      <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center">
        <div className="text-center text-text-secondary">
          <div className="text-3xl mb-3">📋</div>
          <p className="text-sm">任务列表</p>
          <p className="text-xs mt-1">即将推出</p>
        </div>
      </div>
    </div>
  );
}
