interface RightSidebarProps {
  active: "task" | "issue" | "run";
  onSelect: (panel: "task" | "issue" | "run") => void;
  hasRunnable?: boolean;
}

/** 写字板内嵌字母图标 */
function PadIcon({ letter }: { letter: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-[17px] h-[17px]">
      <rect x="5" y="3.5" width="14" height="17.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.5 3.5V2.5h5v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12" y="16.5" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" fontWeight="700" fontFamily="system-ui">{letter}</text>
    </svg>
  );
}

export function RightSidebar({ active, onSelect, hasRunnable }: RightSidebarProps): JSX.Element {
  const items: { id: "task" | "issue" | "run"; label: string; icon: JSX.Element; disabled?: boolean }[] = [
    { id: "task", label: "任务进度", icon: <PadIcon letter="T" /> },
    { id: "issue", label: "问题记录", icon: <PadIcon letter="I" /> },
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
