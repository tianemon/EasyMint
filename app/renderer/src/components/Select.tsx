import { useState, useEffect, useRef } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  title?: string;
  className?: string;
}

const MAX_PANEL_H = 280;

/** 自绘下拉选择：触发器 + fixed 面板（与 ContextMenu 同风格），点击外部/Escape/失焦关闭 */
export function Select({ value, onChange, options, title, className }: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);

  const close = () => { setOpen(false); setPos(null); };

  // 打开时计算 fixed 坐标：先按触发器左缘定位；minWidth 用触发器宽度（fixed 元素 min-w-full 会解析为视口宽度）
  const toggle = () => {
    setOpen((o) => {
      if (!o && ref.current) {
        const r = ref.current.getBoundingClientRect();
        setPos({ left: r.left, top: r.bottom + 4, minWidth: r.width });
      }
      return !o;
    });
  };

  // 面板渲染后测量实际尺寸修正位置：
  // ① 右缘超出视口 → 左移（保持右缘贴边，且与按钮左缘脱开最少）
  // ② 底部空间不足 → 向上弹出（菜单在窗口底部工具栏，向下会被截断）
  useEffect(() => {
    if (!open || !pos || !panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    let nextLeft = pos.left;
    let nextTop = pos.top;
    if (rect.right > window.innerWidth - 8) {
      nextLeft = window.innerWidth - rect.width - 8;
    }
    if (rect.bottom > window.innerHeight) {
      nextTop = Math.max(4, r.top - rect.height - 4);
    }
    if (nextLeft !== pos.left || nextTop !== pos.top) {
      setPos({ ...pos, left: nextLeft, top: nextTop });
    }
  }, [open, pos]);

  // 点击外部 / Escape / 失焦关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onBlur = () => close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        title={title}
        className="inp-sel flex items-center gap-1 cursor-pointer"
        onClick={toggle}
      >
        <span className="truncate max-w-[90px]">{current?.label ?? value}</span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M2 3.5l3 3 3-3" /></svg>
      </button>
      {open && pos && (
        <div
          ref={panelRef}
          className="fixed z-50 w-max py-0 overflow-hidden rounded-[8px] border border-border bg-surface-elevated shadow-xl"
          style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: MAX_PANEL_H }}
        >
          <div className="max-h-full overflow-y-auto">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`w-full flex items-center px-3 py-1.5 text-xs text-left transition-colors ${
                  o.value === value
                    ? "bg-accent-bg text-accent font-medium"
                    : "text-text-primary hover:bg-surface-hover"
                }`}
                onClick={() => { onChange(o.value); close(); }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
