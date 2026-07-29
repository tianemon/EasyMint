interface RightSidebarProps {
  active: "task" | "issue" | "run";
  onSelect: (panel: "task" | "issue" | "run") => void;
  hasRunnable?: boolean;
}

export function RightSidebar({ active, onSelect, hasRunnable }: RightSidebarProps): JSX.Element {
  const items: { id: "task" | "issue" | "run"; label: string; icon: JSX.Element; disabled?: boolean }[] = [
    { id: "task", label: "任务进度", icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <rect x="4" y="4" width="16" height="6" rx="1" /><line x1="4" y1="14" x2="20" y2="14" /><line x1="4" y1="18" x2="16" y2="18" />
      </svg>
    ) },
    { id: "issue", label: "问题记录", icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="13" /><circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ) },
    { id: "run", label: hasRunnable ? "运行" : "无运行程序", icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M8 5.5v13l11-6.5z" />
      </svg>
    ), disabled: !hasRunnable },
  ];

  return (
    <aside className="w-[40px] border-l border-border flex flex-col items-center py-2 bg-surface shrink-0">
      {items.map((it) => (
        <button
          key={it.id}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors mb-1 ${
            active === it.id
              ? "bg-accent-soft text-accent"
              : it.disabled
                ? "text-text-muted opacity-40 cursor-not-allowed"
                : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          }`}
          data-tooltip={it.label}
          onClick={() => !it.disabled && onSelect(it.id)}
          disabled={it.disabled}
        >
          {it.icon}
        </button>
      ))}
    </aside>
  );
}
