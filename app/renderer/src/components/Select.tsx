import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface SelectOption {
  value: string;
  label: string;
  /** 选项图标(品牌 logo 等) */
  icon?: string;
}

interface SelectProps {
  id?: string;
  "aria-describedby"?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  /** block 模式:触发器撑满 + input 样式(表单字段用),否则紧凑 inp-sel */
  block?: boolean;
  placeholder?: string;
  /** 禁用(只读浏览用) */
  disabled?: boolean;
  /** 菜单与触发器左缘或中心对齐（输入栏的紧凑选择器使用中心对齐） */
  align?: "left" | "center";
  /** 用于输入栏浮层：保留阴影层级，去掉边框 */
  borderless?: boolean;
}

const MAX_PANEL_H = 280;

/** 自绘下拉选择：触发器 + fixed 面板（与 ContextMenu 同风格），点击外部/Escape/失焦关闭 */
export function Select({ id, "aria-describedby": describedBy, value, onChange, options, className, block, placeholder, disabled, align = "left", borderless = false }: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; minWidth: number } | null>(null);

  const close = () => { setOpen(false); setPos(null); };
  const focusTrigger = () => ref.current?.querySelector("button")?.focus();

  useEffect(() => {
    if (open) {
      const selected = panelRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      (selected ?? panelRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
    }
  }, [open]);

  // 打开时计算 fixed 坐标：先按触发器左缘定位；minWidth 用触发器宽度（fixed 元素 min-w-full 会解析为视口宽度）
  const toggle = () => {
    // 无选项时不展开:空面板只剩上下边框,渲染成一条横线(如自定义供应商未添加模型时)
    if (options.length === 0) return;
    setOpen((o) => {
      if (!o && ref.current) {
        const r = ref.current.getBoundingClientRect();
        setPos({ left: align === "center" ? r.left + r.width / 2 : r.left, top: r.bottom + 4, minWidth: r.width });
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
    if (align === "center" && rect.left < 8) {
      nextLeft = rect.width / 2 + 8;
    } else if (align === "center" && rect.right > window.innerWidth - 8) {
      nextLeft = window.innerWidth - rect.width / 2 - 8;
    } else if (rect.right > window.innerWidth - 8) {
      nextLeft = window.innerWidth - rect.width - 8;
    }
    if (rect.bottom > window.innerHeight) {
      nextTop = Math.max(4, r.top - rect.height - 4);
    }
    if (nextLeft !== pos.left || nextTop !== pos.top) {
      setPos({ ...pos, left: nextLeft, top: nextTop });
    }
  }, [align, open, pos]);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); focusTrigger(); } };
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
        id={id}
        type="button"
        aria-describedby={describedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className={block
          ? `em-select-trigger w-full flex items-center justify-between px-3 py-2 rounded-[var(--radius-lg)] bg-surface border border-border text-text-primary text-sm outline-none ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`
          : `inp-sel flex items-center gap-1 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        onClick={toggle}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <span className={`flex items-center gap-1.5 ${block ? "min-w-0" : ""}`}>
          {current?.icon && <img src={current.icon} className="w-3.5 h-3.5 shrink-0 object-contain" alt="" />}
          <span className={block ? "truncate" : "truncate max-w-[160px]"}>{current?.label ?? placeholder ?? value}</span>
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-text-secondary ${block ? "" : ""}`}><path d="M2 3.5l3 3 3-3" /></svg>
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-labelledby={id}
          onKeyDown={(event) => {
            const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "ArrowDown" ? (index + 1) % buttons.length
              : event.key === "ArrowUp" ? (index - 1 + buttons.length) % buttons.length
              : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
            if (next >= 0) { event.preventDefault(); buttons[next]?.focus(); }
          }}
          className={`fixed z-dropdown w-max py-0 overflow-hidden rounded-[var(--radius-lg)] bg-surface-elevated shadow-xl ${borderless ? "" : "border border-border"}`}
          style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth, maxHeight: MAX_PANEL_H, transform: align === "center" ? "translateX(-50%)" : undefined }}
        >
          <div className="overflow-y-auto" style={{ maxHeight: MAX_PANEL_H }}>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                  o.value === value
                    ? "bg-accent-bg text-accent font-medium"
                    : "text-text-primary hover:bg-surface-hover"
                }`}
                onClick={() => { onChange(o.value); close(); focusTrigger(); }}
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
