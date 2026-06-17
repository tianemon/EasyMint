import { useState, useRef, useEffect } from "react";

interface QuickPrompt {
  label: string;
  desc: string;
  template: string;
}

const ALL_PROMPTS: QuickPrompt[] = [
  {
    label: "简化方案",
    desc: "强制最简实现，标准库优先，一行代码好过五十行",
    template: "用 ponytail skill，给我最简方案。",
  },
  {
    label: "精简审查",
    desc: "审查最近改动，找出过度设计的代码",
    template: "用 ponytail-review skill，审查最近的改动有没有过度设计。",
  },
  {
    label: "全库体检",
    desc: "扫描整个项目，列出该删、该简化、该替换的",
    template: "用 ponytail-audit skill，扫描整个项目的臃肿代码。",
  },
];

interface QuickPromptsProps {
  onFill: (text: string) => void;
}

export function QuickPrompts({ onFill }: QuickPromptsProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={`w-9 h-9 rounded-md border flex items-center justify-center transition-colors ${open ? "border-accent text-accent bg-accent-bg" : "border-border text-text-secondary hover:border-accent/50 hover:text-accent"}`}
        title="快捷操作"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M2 3h12a1 1 0 011 1v8a1 1 0 01-1 1H6l-2.5 2.5L3 13H2a1 1 0 01-1-1V4a1 1 0 011-1z" />
          <path d="M5 7h6M5 10h4" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-52 bg-surface-elevated border border-border rounded-lg shadow-md overflow-hidden z-50">
          {ALL_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); onFill(p.template); }}
              className="w-full px-3 py-1.5 hover:bg-surface-hover transition-colors text-left border-b border-border last:border-0"
            >
              <div className="text-xs font-medium text-text-primary">{p.label}</div>
              <div className="text-[10px] text-text-muted mt-0.5 leading-tight">{p.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
