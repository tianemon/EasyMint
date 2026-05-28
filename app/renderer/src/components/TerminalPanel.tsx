import { useEffect, useRef, useState } from "react";

interface TerminalTab {
  id: string;
  title: string;
}

interface TerminalPanelProps {
  projectId: string;
}

export function TerminalPanel({ projectId }: TerminalPanelProps): JSX.Element {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  const createTerminal = async () => {
    // Will use xterm.js Terminal + node-pty via IPC
    // Stub: xterm.js integration in automation task
    const tab: TerminalTab = {
      id: `tab-${Date.now()}`,
      title: `终端 ${tabs.length + 1}`,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTab(tab.id);
  };

  useEffect(() => {
    createTerminal();
  }, [projectId]);

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-surface-alt">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`px-3 py-1 text-xs rounded-t transition-colors ${
              activeTab === tab.id
                ? "bg-surface text-text-primary border-t border-l border-r border-border"
                : "text-text-secondary hover:text-text-primary"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.title}
          </button>
        ))}
        <button
          className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
          onClick={createTerminal}
        >
          +
        </button>
      </div>

      {/* Terminal area */}
      <div ref={terminalRef} className="flex-1 bg-black/90" />
    </div>
  );
}
