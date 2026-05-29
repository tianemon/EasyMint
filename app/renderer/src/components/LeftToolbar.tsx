import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { ActivePanel } from "../pages/ProjectPage";

interface ToolDef {
  id?: ActivePanel;
  label: string;
  svg: JSX.Element;
  disabled?: boolean;
}

const TOOLS: ToolDef[] = [
  {
    id: "files", label: "项目文件",
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 3v18"/></svg>,
  },
  {
    id: "sessions", label: "会话",
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  },
  {
    label: "终端 · 即将推出",
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
    disabled: true,
  },
];

interface LeftToolbarProps {
  activePanel: ActivePanel;
  onSelect: (panel: ActivePanel) => void;
  onSettings?: () => void;
}

export function LeftToolbar({ activePanel, onSelect, onSettings }: LeftToolbarProps): JSX.Element {
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const handleDropdownItem = (action: string) => {
    setShowDropdown(false);
    if (action === "project") navigate("/projects");
  };

  return (
    <aside className="w-[44px] flex flex-col items-center py-2 bg-surface shrink-0">
      {/* New button with dropdown */}
      <div ref={dropdownRef} className="relative">
        <button
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
            showDropdown ? "bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] text-accent" : "hover:bg-surface-hover text-text-secondary"
          }`}
          data-tooltip="新建…"
          onClick={() => setShowDropdown(!showDropdown)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
        {showDropdown && (
          <div className="absolute left-full top-0 ml-1 w-36 bg-surface border border-border rounded-[10px] shadow-lg py-1 z-50 dropdown-menu">
            <button className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors" onClick={() => handleDropdownItem("project")}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 inline mr-2"><rect x="3" y="3" width="10" height="10" rx="3"/><path d="M3 7h10M7 3v5"/></svg>
              新建项目
            </button>
          </div>
        )}
      </div>

      <div className="w-[18px] h-px bg-border my-1" />

      {/* Tool buttons */}
      <div className="flex flex-col items-center gap-0.5">
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
              tool.disabled
                ? "opacity-35 cursor-not-allowed text-text-secondary"
                : activePanel === tool.id
                  ? "bg-[color-mix(in_oklab,var(--color-accent)_12%,transparent)] text-accent"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            }`}
            data-tooltip={tool.label}
            disabled={tool.disabled}
            onClick={() => {
              if (tool.id) onSelect(tool.id === activePanel ? "editor" : tool.id);
            }}
          >
            {tool.svg}
          </button>
        ))}
      </div>

      {/* Settings button — pinned to bottom */}
      <button
        className="w-8 h-8 rounded-md flex items-center justify-center text-text-secondary transition-colors mt-auto hover:bg-surface-hover hover:text-text-primary"
        data-tooltip="设置"
        onClick={() => onSettings?.()}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]">
          <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
    </aside>
  );
}
