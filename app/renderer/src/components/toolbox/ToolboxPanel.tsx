import { uiText, useUiLocale } from "../../lib/i18n";
import { useEffect, useRef } from "react";
import { useDeviceStore } from "../../stores/device-store";

/**
 * 工具箱弹层:侧边栏底部工具箱按钮弹出。
 * 收纳隐藏功能:HTML 原型编辑器(现有 resources/em-html-editor,前端此前零入口) + 项目迁移 + 连接手机。
 * 「项目迁移」(电脑↔电脑迁移项目)与「连接手机」(电脑↔手机)是两条独立链路,各一个入口。
 */
interface ToolboxPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenMigrationPanel: () => void;
  onOpenMobilePanel: () => void;
}

export function ToolboxPanel({ open, onClose, onOpenMigrationPanel, onOpenMobilePanel }: ToolboxPanelProps): JSX.Element | null {
  useUiLocale();
  const ref = useRef<HTMLDivElement>(null);
  const loadDevices = useDeviceStore((s) => s.load);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // 打开时预载设备列表(项目迁移面板随时可开)
  useEffect(() => {
    if (open) loadDevices();
  }, [open, loadDevices]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-[54px] right-3 w-56 em-glass rounded-[var(--radius-lg)] shadow-lg overflow-hidden z-float"
    >
      <div className="px-4 py-2.5 text-xs font-medium text-text-primary border-b border-border">{uiText("ui.ToolboxPanel.toolbox")}</div>
      <div className="p-1.5">
        <button
          type="button"
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-lg)] hover:bg-surface-hover transition-colors text-left"
          onClick={() => window.electronAPI.editor.open()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary shrink-0">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M9 13h6M9 17h6M9 9h1" />
          </svg>
          <span className="min-w-0">
            <span className="block text-xs text-text-primary leading-tight">
              {uiText("ui.ToolboxPanel.htmlPrototypeEditor")}<span className="ml-1.5 text-[length:var(--text-3xs)] px-1 py-px rounded-[var(--radius-lg)] bg-accent-soft text-accent align-middle">{uiText("ui.ToolboxPanel.experimental")}</span>
            </span>
            <span className="block text-[length:var(--text-2xs)] text-text-muted leading-tight">{uiText("ui.ToolboxPanel.visuallyEditPagePrototypes")}</span>
          </span>
        </button>
        <button
          type="button"
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-lg)] hover:bg-surface-hover transition-colors text-left"
          onClick={() => { onClose(); onOpenMigrationPanel(); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary shrink-0">
            <path d="m16 3 4 4-4 4" />
            <path d="M20 7H4" />
            <path d="m8 21-4-4 4-4" />
            <path d="M4 17h16" />
          </svg>
          <span className="min-w-0">
            <span className="block text-xs text-text-primary leading-tight">
              {uiText("ui.DevicePanel.projectTransfer")}<span className="ml-1.5 text-[length:var(--text-3xs)] px-1 py-px rounded-[var(--radius-lg)] bg-accent-soft text-accent align-middle">{uiText("ui.ToolboxPanel.experimental")}</span>
            </span>
            <span className="block text-[length:var(--text-2xs)] text-text-muted leading-tight">{uiText("ui.ToolboxPanel.transferSessionsAndProjectsBetweenDevices")}</span>
          </span>
        </button>
        <button
          type="button"
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-lg)] hover:bg-surface-hover transition-colors text-left"
          onClick={() => { onClose(); onOpenMobilePanel(); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary shrink-0">
            <rect x="6" y="2" width="12" height="20" rx="2.5" />
            <path d="M11 18.5h2" />
          </svg>
          <span className="min-w-0">
            <span className="block text-xs text-text-primary leading-tight">
              {uiText("ui.MobileTerminalPanel.connectPhone")}<span className="ml-1.5 text-[length:var(--text-3xs)] px-1 py-px rounded-[var(--radius-lg)] bg-accent-soft text-accent align-middle">{uiText("ui.ToolboxPanel.experimental")}</span>
            </span>
            <span className="block text-[length:var(--text-2xs)] text-text-muted leading-tight">{uiText("ui.ToolboxPanel.pairYourPhoneToViewConversations")}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
