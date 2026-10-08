import { appText, useUiLocale } from "../lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

export interface ContextMenuData {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

export function contextMenuPosition(x: number, y: number, width: number, height: number, viewportWidth: number, viewportHeight: number) {
  return {
    left: Math.max(4, Math.min(x, viewportWidth - width - 4)),
    top: Math.max(4, Math.min(y, viewportHeight - height - 4)),
  };
}

/** 轻量右键菜单：fixed 定位在鼠标处，点击外部/Escape/失焦关闭 */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuData | null; onClose: () => void }): JSX.Element | null {
  const locale = useUiLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: menu?.x ?? 0, top: menu?.y ?? 0 });
  useLayoutEffect(() => {
    if (!menu) return;
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (rect) setPosition(contextMenuPosition(menu.x, menu.y, rect.width, rect.height, window.innerWidth, window.innerHeight));
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [menu, locale]);
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
  return (
    <div
      ref={ref}
      data-context-menu
      className="fixed z-dropdown w-max max-w-[calc(100vw-8px)] max-h-[calc(100vh-8px)] py-0 overflow-x-hidden overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-surface-elevated shadow-xl"
      style={position}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) => (
        <button
          key={i}
          className="w-full flex items-center px-3 py-1.5 text-xs text-text-primary hover:bg-surface-hover transition-colors text-left"
          onClick={() => { onClose(); item.onClick(); }}
        >
          {appText(item.label)}
        </button>
      ))}
    </div>
  );
}
