import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  /** 选项图标(品牌 logo 等) */
  icon?: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  title?: string;
  className?: string;
  /** block 模式:触发器撑满 + input 样式(表单字段用),否则紧凑 inp-sel */
  block?: boolean;
  placeholder?: string;
  /** 禁用(只读浏览用) */
  disabled?: boolean;
}

const MAX_PANEL_H = 280;

/** 自绘下拉选择：触发器 + fixed 面板（与 ContextMenu 同风格），点击外部/Escape/失焦关闭 */
export function Select({ value, onChange, options, title, className, block, placeholder, disabled }: SelectProps): JSX.Element {
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
  // 注意:面板 Portal 到 body,须把 panelRef 也视为内部——否则点击面板 option 会先触发
  // mousedown 的 close(option 不在触发器 ref 内)卸载面板,导致后续 click 的 onChange 丢失
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const inTrigger = ref.current?.contains(e.target as Node);
      const inPanel = panelRef.current?.contains(e.target as Node);
      if (!inTrigger && !inPanel) close();
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
    <div ref={ref} className={`relative ${block ? "w-full" : "inline-block"} ${className ?? ""}`}>
      <button
        type="button"
        title={title}
        disabled={disabled}
        className={block
          ? `w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-sm outline-none focus:border-accent transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-accent-border-strong"}`
          : `inp-sel flex items-center gap-1 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        onClick={toggle}
      >
        <span className={`flex items-center gap-1.5 ${block ? "min-w-0" : ""}`}>
          {current?.icon && <img src={current.icon} className="w-3.5 h-3.5 shrink-0 object-contain" alt="" />}
          <span className={block ? "truncate" : "truncate max-w-[90px]"}>{current?.label ?? placeholder ?? value}</span>
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-text-secondary ${block ? "" : ""}`}><path d="M2 3.5l3 3 3-3" /></svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[300] w-max py-0 overflow-hidden rounded-[8px] border border-border bg-surface-elevated shadow-xl"
          style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: MAX_PANEL_H }}
        >
          <div className="overflow-y-auto" style={{ maxHeight: MAX_PANEL_H }}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                  o.value === value
                    ? "bg-accent-bg text-accent font-medium"
                    : "text-text-primary hover:bg-surface-hover"
                }`}
                onClick={() => { onChange(o.value); close(); }}
              >
                {o.icon && <img src={o.icon} className="w-3.5 h-3.5 shrink-0 object-contain" alt="" />}
                <span className="truncate">{o.label}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
