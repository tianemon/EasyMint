import { useEffect } from "react";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

export interface ContextMenuData {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** 轻量右键菜单：fixed 定位在鼠标处，点击外部/Escape/失焦关闭 */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuData | null; onClose: () => void }): JSX.Element | null {
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-context-menu]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  // 宽度由内容自适应（w-max），右缘 clamp 按菜单典型宽度预留
  const left = Math.min(menu.x, window.innerWidth - 200);
  const top = Math.min(menu.y, window.innerHeight - 140);
  return (
    <div
      data-context-menu
      className="fixed z-50 w-max min-w-[96px] py-1 rounded-lg border border-border bg-surface-elevated shadow-xl"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) => (
        <button
          key={i}
          className="w-full flex items-center px-3 py-1.5 text-xs text-text-primary hover:bg-surface-hover transition-colors text-left"
          onClick={() => { onClose(); item.onClick(); }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
