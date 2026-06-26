import { useState, useRef, useEffect } from "react";
import type { ActivePanel } from "../pages/ProjectPage";
import { useThemeStore } from "../stores/theme-store";

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
  onShowUpdate?: () => void;  // 点「有新版本」→ 跳到关于页
  onNewProject?: () => void;
  onOpenProject?: () => void;
  onRenameProject?: () => void;
}

function ThemeToggleButton(): JSX.Element {
  const mode = useThemeStore((s) => s.mode);
  const toggle = useThemeStore((s) => s.toggle);

  const tooltip = mode === "light" ? "亮色" : mode === "dark" ? "暗色" : "自动";

  const icon = mode === "light" ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]">
      <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>
  ) : mode === "dark" ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]">
      <circle cx="12" cy="12" r="9"/><text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="11" fontWeight="700" fontFamily="system-ui">A</text>
    </svg>
  );

  return (
    <button
      className="w-8 h-8 rounded-md flex items-center justify-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary mb-1"
      data-tooltip={`主题 · ${tooltip}`}
      onClick={toggle}
    >
      {icon}
    </button>
  );
}

export function LeftToolbar({ activePanel, onSelect, onSettings, onShowUpdate, onNewProject, onOpenProject, onRenameProject }: LeftToolbarProps): JSX.Element {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  // updatePhase: null=无更新, "available"=检测到正在下载, "downloaded"=已下载完
  const [updatePhase, setUpdatePhase] = useState<"available" | "downloaded" | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  // 启动时同步状态 + 监听实时广播
  useEffect(() => {
    window.electronAPI?.app?.hasUpdate?.().then(({ hasUpdate, version }) => {
      if (hasUpdate && version) {
        setUpdateVersion(version);
        setUpdatePhase("downloaded");
      }
    }).catch(() => {});
    const off = window.electronAPI?.app?.onUpdateStatus?.((data) => {
      if (data.status === "downloaded" && data.version) {
        setUpdateVersion(data.version);
        setUpdatePhase("downloaded");
      }
      if (data.status === "available" && data.version) {
        setUpdateVersion(data.version);
        setUpdatePhase("available");
      }
      if (data.status === "no-update") {
        setUpdateVersion(null);
        setUpdatePhase(null);
      }
    });
    return () => { off?.(); };
  }, []);

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

  useEffect(() => {
    if (!showSettingsMenu) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSettingsMenu]);

  const handleDropdownItem = (action: string) => {
    setShowDropdown(false);
    if (action === "project") onNewProject?.();
    else if (action === "openproject") onOpenProject?.();
    else if (action === "renameproject") onRenameProject?.();
    else if (action === "newwindow") window.electronAPI.window.newWindow();
    else if (action === "file") {
      const name = prompt("输入文件名（例如：config.ts）：");
      if (name) console.log("新建文件:", name);
    } else if (action === "folder") {
      const name = prompt("输入文件夹名：");
      if (name) console.log("新建文件夹:", name);
    }
  };

  const handleSettingsClick = () => {
    if (updatePhase === "downloaded") {
      setShowSettingsMenu(!showSettingsMenu);
    } else if (updatePhase === "available") {
      onShowUpdate?.();
    } else {
      onSettings?.();
    }
  };

  const handleInstallUpdate = () => {
    setShowSettingsMenu(false);
    window.electronAPI?.app?.installUpdate?.();
  };

  return (
    <aside className="w-[44px] border-r border-border flex flex-col items-center py-2 bg-surface shrink-0">
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
            <button className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors" onClick={() => handleDropdownItem("openproject")}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 inline mr-2"><path d="M2 4.5v7a1 1 0 001 1h10a1 1 0 001-1v-7M2 4.5L8 8l6-3.5M2 4.5a1 1 0 011-1h10a1 1 0 011 1"/></svg>
              打开项目
            </button>
            {onRenameProject && (
              <button className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors" onClick={() => handleDropdownItem("renameproject")}>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 inline mr-2"><path d="M14.5 1.5l-3 3-1.5-1.5 3-3"/><path d="M11 4.5l-9 9v1.5H3.5l9-9"/></svg>
                重命名项目
              </button>
            )}
            <div className="border-t border-border my-0.5" />
            <button className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors" onClick={() => handleDropdownItem("file")}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 inline mr-2"><path d="M10 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V5l-3-3z"/><path d="M10 2v3h3"/></svg>
              新建文件
            </button>
            <button className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors" onClick={() => handleDropdownItem("folder")}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 inline mr-2"><path d="M2 4a1 1 0 011-1h3l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/></svg>
              新建文件夹
            </button>
            <div className="border-t border-border my-0.5" />
            <button className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors" onClick={() => handleDropdownItem("newwindow")}>           <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 inline mr-2"><rect x="2" y="2" width="12" height="12" rx="3"/><path d="M8 3v11M3 8h11"/></svg>
              新建窗口
            </button>
          </div>
        )}
      </div>

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
              if (tool.id) onSelect(tool.id);
            }}
          >
            {tool.svg}
          </button>
        ))}
      </div>

      {/* Theme + Settings — pinned to bottom */}
      <div className="mt-auto" />
      <ThemeToggleButton />

      {/* Settings button — pinned to bottom */}
      <div ref={settingsRef} className="relative">
        <button
          className="w-8 h-8 rounded-md flex items-center justify-center text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          data-tooltip={updatePhase ? `有新版本 v${updateVersion}` : "设置"}
          onClick={handleSettingsClick}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-[17px] h-[17px]">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
          {updatePhase && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-danger border border-surface" />
          )}
        </button>
        {showSettingsMenu && updatePhase === "downloaded" && (
          <div className="absolute left-full bottom-0 ml-1 w-44 bg-surface border border-border rounded-[10px] shadow-lg py-1 z-50 dropdown-menu">
            <button
              className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors"
              onClick={handleInstallUpdate}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 inline mr-2 text-accent"><path d="M8 1v9M4.5 6.5L8 10l3.5-3.5"/><path d="M2.5 13h11"/></svg>
              重启升级到 v{updateVersion}
            </button>
            <div className="border-t border-border my-0.5" />
            <button
              className="w-full text-left px-3 py-2 text-xs text-text-primary hover:bg-surface-hover transition-colors"
              onClick={() => { setShowSettingsMenu(false); onSettings?.(); }}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 inline mr-2"><circle cx="8" cy="8" r="2"/><path d="M12.5 10a1 1 0 00.2 1.1l0 0a1.2 1.2 0 11-1.7 1.7l0 0a1 1 0 00-1.1-.2 1 1 0 00-.6.9V14a1.2 1.2 0 01-2.4 0v-.1a1 1 0 00-.6-.9 1 1 0 00-1.1.2l0 0a1.2 1.2 0 11-1.7-1.7l0 0a1 1 0 00.2-1.1 1 1 0 00-.9-.6H2a1.2 1.2 0 010-2.4h.1a1 1 0 00.9-.6 1 1 0 00-.2-1.1l0 0a1.2 1.2 0 111.7-1.7l0 0a1 1 0 001.1.2H6a1 1 0 00.6-.9V2a1.2 1.2 0 012.4 0v.1a1 1 0 00.6.9 1 1 0 001.1-.2l0 0a1.2 1.2 0 111.7 1.7l0 0a1 1 0 00-.2 1.1V6a1 1 0 00.9.6H14a1.2 1.2 0 010 2.4h-.1a1 1 0 00-.9.6z"/></svg>
              打开设置
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
