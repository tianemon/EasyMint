import { useState, useRef, useEffect } from "react";

interface QuickPrompt {
  label: string;
  desc: string;
  template: string;
}

const ALL_PROMPTS: QuickPrompt[] = [
  {
    label: "查看进度",
    desc: "汇报已完成和未完成的任务",
    template: "查看一下当前项目进度，汇报已完成和未完成的任务，以及下一步计划。",
  },
  {
    label: "调整需求",
    desc: "修改已有的需求或设计",
    template: "帮我调整一下需求：\n- 原来：\n- 改为：",
  },
  {
    label: "报告 Bug",
    desc: "结构化描述问题，便于定位",
    template: "请帮我排查一个 Bug：\n- 问题描述：\n- 预期行为：\n- 实际行为：\n- 复现步骤：",
  },
  {
    label: "新功能",
    desc: "描述想要的功能和交互流程",
    template: "帮我实现一个新功能：\n- 功能描述：\n- 交互流程：\n- 关联页面/模块：",
  },
  {
    label: "代码审查",
    desc: "检查代码质量和潜在问题",
    template: "帮我审查一下最近的代码变更，检查代码质量、潜在问题和改进空间。",
  },
  {
    label: "技术咨询",
    desc: "技术选型、架构决策等专业问题",
    template: "我有一个技术问题想咨询：\n- 场景：\n- 备选方案：\n- 我的考量：",
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
        className="w-9 h-9 rounded-md border border-border flex items-center justify-center text-text-secondary hover:border-accent hover:text-accent transition-colors"
        title="快捷操作"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M2 3h12a1 1 0 011 1v8a1 1 0 01-1 1H6l-2.5 2.5L3 13H2a1 1 0 01-1-1V4a1 1 0 011-1z" />
          <path d="M5 7h6M5 10h4" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-60 bg-surface-elevated border border-border rounded-lg shadow-lg overflow-hidden z-50">
          {ALL_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => { setOpen(false); onFill(p.template); }}
              className="w-full px-3 py-2 hover:bg-surface-alt transition-colors text-left border-b border-border/30 last:border-0"
            >
              <div className="text-xs text-text-primary">{p.label}</div>
              <div className="text-[10px] text-text-secondary mt-0.5">{p.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
