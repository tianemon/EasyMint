import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { ActivePanel } from "../pages/ProjectPage";

interface ToolDef {
  id?: ActivePanel;
  label: string;
  icon: string;
  disabled?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: "files", label: "项目文件", icon: "🌳" },
  { id: "sessions", label: "会话", icon: "💬" },
  { id: "chat", label: "Chat 对话", icon: "💭" },
  { label: "终端 · 即将推出", icon: ">_", disabled: true },
];

interface LeftToolbarProps {
  activePanel: ActivePanel;
  onSelect: (panel: ActivePanel) => void;
}

export function LeftToolbar({ activePanel, onSelect }: LeftToolbarProps): JSX.Element {
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
    <aside className="w-[44px] border-r border-border flex flex-col items-center py-3 bg-surface-alt shrink-0">
      {/* New button with dropdown */}
      <div ref={dropdownRef} className="relative">
        <button
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg font-medium transition-colors ${
            showDropdown ? "bg-accent/20 ring-1 ring-accent/30" : "hover:bg-surface-hover"
          }`}
          data-tooltip="新建"
          onClick={() => setShowDropdown(!showDropdown)}
        >
          +
        </button>
        {showDropdown && (
          <div className="absolute left-full top-0 ml-1 w-36 bg-white border border-border rounded-lg shadow-lg py-1 z-50 dropdown-menu">
            <button
              className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors"
              onClick={() => handleDropdownItem("project")}
            >
              新建项目
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors"
              onClick={() => handleDropdownItem("file")}
            >
              新建文件
            </button>
            <button
              className="w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-surface-hover transition-colors"
              onClick={() => handleDropdownItem("folder")}
            >
              新建文件夹
            </button>
          </div>
        )}
      </div>

      <div className="w-6 h-px bg-border my-2.5" />

      {/* Tool buttons — evenly spaced */}
      <div className="flex-1 flex flex-col items-center justify-evenly">
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-colors ${
              tool.disabled
                ? "opacity-35 cursor-not-allowed"
                : activePanel === tool.id
                  ? "bg-accent/20 ring-1 ring-accent/30"
                  : "hover:bg-surface-hover"
            }`}
            data-tooltip={tool.label}
            disabled={tool.disabled}
            onClick={() => {
              if (tool.id) onSelect(tool.id === activePanel ? "editor" : tool.id);
            }}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      {/* Settings button — pinned to bottom */}
      <button
        className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-colors mt-auto ${
          activePanel === "settings" ? "bg-accent/20 ring-1 ring-accent/30" : "hover:bg-surface-hover"
        }`}
        data-tooltip="设置"
        onClick={() => onSelect(activePanel === "settings" ? "editor" : "settings")}
      >
        ⚙
      </button>
    </aside>
  );
}
