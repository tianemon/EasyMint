import { useNavigate } from "react-router-dom";
import type { ActivePanel } from "../pages/ProjectPage";

const TOOLS: { id: ActivePanel; label: string; icon: string }[] = [
  { id: "files", label: "项目文件", icon: "🌳" },
  { id: "sessions", label: "会话", icon: "💬" },
  { id: "chat", label: "Chat 对话", icon: "💭" },
  { id: "settings", label: "设置", icon: "⚙" },
];

interface LeftToolbarProps {
  activePanel: ActivePanel;
  onSelect: (panel: ActivePanel) => void;
}

export function LeftToolbar({ activePanel, onSelect }: LeftToolbarProps): JSX.Element {
  const navigate = useNavigate();

  return (
    <aside className="w-[44px] border-r border-border flex flex-col items-center py-3 bg-surface-alt shrink-0">
      {/* New project button */}
      <button
        className="w-8 h-8 rounded-lg flex items-center justify-center text-base hover:bg-surface-hover transition-colors"
        data-tooltip="新建项目/文件/文件夹"
        onClick={() => navigate("/projects")}
      >
        📁
      </button>

      <div className="w-6 h-px bg-border my-2.5" />

      {/* Tool buttons — evenly spaced */}
      <div className="flex-1 flex flex-col items-center justify-evenly">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-base transition-colors ${
              activePanel === tool.id ? "bg-accent/20 ring-1 ring-accent/30" : "hover:bg-surface-hover"
            }`}
            data-tooltip={tool.label}
            onClick={() => onSelect(tool.id === activePanel ? "editor" : tool.id)}
          >
            {tool.icon}
          </button>
        ))}
      </div>
    </aside>
  );
}
