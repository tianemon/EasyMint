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

/** 自绘下拉选择：触发器 + 自定义面板（与 ContextMenu 同风格），点击外部关闭 */
export function Select({ value, onChange, options, title, className }: SelectProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={`relative inline-block ${className ?? ""}`}>
      <button
        type="button"
        title={title}
        className="inp-sel flex items-center gap-1 cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate max-w-[90px]">{current?.label ?? value}</span>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M2 3.5l3 3 3-3" /></svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-max min-w-full py-0 overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-xl">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`w-full flex items-center px-3 py-1.5 text-xs text-left transition-colors ${
                o.value === value
                  ? "bg-accent-bg text-accent font-medium"
                  : "text-text-primary hover:bg-surface-hover"
              }`}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
