import { useNavigate } from "react-router-dom";
import type { ActivePanel } from "../pages/ProjectPage";

const TOOLS: { id: ActivePanel; label: string; icon: string }[] = [
  { id: "files", label: "项目结构", icon: "🌳" },
  { id: "sessions", label: "对话历史", icon: "💬" },
  { id: "chat", label: "Chat", icon: "💭" },
  { id: "settings", label: "设置", icon: "⚙" },
];

interface LeftToolbarProps {
  activePanel: ActivePanel;
  onSelect: (panel: ActivePanel) => void;
}

export function LeftToolbar({ activePanel, onSelect }: LeftToolbarProps): JSX.Element {
  const navigate = useNavigate();

  return (
    <aside className="w-14 border-r border-border flex flex-col items-center py-4 gap-2 bg-surface-alt">
      <button
        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg hover:bg-surface-hover transition-colors"
        title="新建项目"
        onClick={() => navigate("/")}
      >
        📁
      </button>
      <div className="w-8 h-px bg-border my-2" />
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-colors ${
            activePanel === tool.id ? "bg-accent/20 ring-1 ring-accent/30" : "hover:bg-surface-hover"
          }`}
          title={tool.label}
          onClick={() => onSelect(tool.id === activePanel ? "editor" : tool.id)}
        >
          {tool.icon}
        </button>
      ))}
    </aside>
  );
}
