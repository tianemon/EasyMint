import { useMemo } from "react";
import {
  TASK_ALLOCATION_INSTRUCTION,
  ANALYZE_REQUIREMENTS_PROMPT,
  CONTINUE_EXECUTION_PROMPT,
  CHECK_PROGRESS_PROMPT,
} from "../../../shared/prompts";
import type { ProjectStage } from "../stores/project-status-store";

interface QuickPrompt {
  label: string;
  icon: string;
  text: string;
  action: "send" | "fill";
}

interface QuickPromptsProps {
  stage: ProjectStage;
  onSend: (text: string) => void;
  onFill: () => void;
}

export function QuickPrompts({ stage, onSend, onFill }: QuickPromptsProps): JSX.Element | null {
  const prompts = useMemo<QuickPrompt[]>(() => {
    switch (stage) {
      case "requirements":
      case "tech-selection":
      case "init":
        return [
          { label: "初始化项目", icon: "🚀", text: "帮我初始化开发环境", action: "send" as const },
          { label: "分析需求", icon: "📋", text: ANALYZE_REQUIREMENTS_PROMPT, action: "send" as const },
        ];

      case "planning":
        return [
          { label: "分配任务", icon: "📝", text: TASK_ALLOCATION_INSTRUCTION, action: "send" as const },
          { label: "调整需求", icon: "✏️", text: "", action: "fill" as const },
        ];

      case "developing":
        return [
          { label: "继续执行", icon: "▶️", text: CONTINUE_EXECUTION_PROMPT, action: "send" as const },
          { label: "查看进度", icon: "📊", text: CHECK_PROGRESS_PROMPT, action: "send" as const },
          { label: "报告 Bug", icon: "🐛", text: "", action: "fill" as const },
          { label: "新功能", icon: "✨", text: "", action: "fill" as const },
        ];

      case "done":
        return [
          { label: "新功能", icon: "✨", text: "", action: "fill" as const },
          { label: "报告 Bug", icon: "🐛", text: "", action: "fill" as const },
        ];

      default:
        return [];
    }
  }, [stage]);

  if (prompts.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 shrink-0 flex-wrap">
      {prompts.map((p, i) => (
        <button
          key={`qp-${i}`}
          onClick={() => p.action === "send" ? onSend(p.text) : onFill()}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] leading-none
            bg-surface-alt border border-border text-text-secondary
            hover:bg-accent/10 hover:border-accent/30 hover:text-accent
            transition-colors"
          title={p.action === "fill" ? "点击后输入具体内容" : undefined}
        >
          <span className="text-xs">{p.icon}</span>
          <span>{p.label}</span>
        </button>
      ))}
    </div>
  );
}
