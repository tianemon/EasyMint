import { useEffect, useRef } from "react";
import { useDeviceStore } from "../../stores/device-store";

/**
 * 工具箱弹层:侧边栏底部工具箱按钮弹出。
 * 收纳隐藏功能:HTML 原型编辑器(现有 resources/em-html-editor,前端此前零入口) + 设备互联。
 */
interface ToolboxPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenDevicePanel: () => void;
}

export function ToolboxPanel({ open, onClose, onOpenDevicePanel }: ToolboxPanelProps): JSX.Element | null {
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

  // 打开时预载设备列表(设备互联面板随时可开)
  useEffect(() => {
    if (open) loadDevices();
  }, [open, loadDevices]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className="absolute bottom-[54px] right-3 w-56 bg-surface-alt rounded-lg border border-border shadow-lg overflow-hidden z-40"
    >
      <div className="px-4 py-2.5 text-xs font-medium text-text-primary border-b border-border">工具箱</div>
      <div className="p-1.5">
        <button
          type="button"
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md hover:bg-surface-hover transition-colors text-left"
          onClick={() => window.electronAPI.editor.open()}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary shrink-0">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <path d="M9 13h6M9 17h6M9 9h1" />
          </svg>
          <span className="min-w-0">
            <span className="block text-xs text-text-primary leading-tight">
              HTML 原型编辑器
              <span className="ml-1.5 text-[length:var(--text-3xs)] px-1 py-px rounded bg-accent-soft text-accent align-middle">实验</span>
            </span>
            <span className="block text-[length:var(--text-2xs)] text-text-muted leading-tight">可视化编辑页面原型</span>
          </span>
        </button>
        <button
          type="button"
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md hover:bg-surface-hover transition-colors text-left"
          onClick={() => { onClose(); onOpenDevicePanel(); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary shrink-0">
            <path d="m16 3 4 4-4 4" />
            <path d="M20 7H4" />
            <path d="m8 21-4-4 4-4" />
            <path d="M4 17h16" />
          </svg>
          <span className="min-w-0">
            <span className="block text-xs text-text-primary leading-tight">
              项目迁移
              <span className="ml-1.5 text-[length:var(--text-3xs)] px-1 py-px rounded bg-accent-soft text-accent align-middle">实验</span>
            </span>
            <span className="block text-[length:var(--text-2xs)] text-text-muted leading-tight">跨设备迁移会话与项目</span>
          </span>
        </button>
      </div>
    </div>
  );
}
