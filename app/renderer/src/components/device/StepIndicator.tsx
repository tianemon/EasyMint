/**
 * 迁移步骤指示条:水平步骤列表,当前步骤转圈、已完成 ✓、待办灰色。
 * 发送端/接收端共用。
 */
interface Step {
  id: string;
  label: string;
}

interface StepIndicatorProps {
  steps: Step[];
  /** 当前步骤 id(0 个 = 未开始,全部完成传最后一个之后的标记) */
  current: string;
}

export function StepIndicator({ steps, current }: StepIndicatorProps): JSX.Element {
  const currentIdx = steps.findIndex((s) => s.id === current);
  const allDone = current === "__done__";
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {steps.map((s, i) => {
        const done = allDone || i < currentIdx;
        const active = !allDone && i === currentIdx;
        return (
          <div key={s.id} className="flex items-center gap-1.5">
            {i > 0 && <span className="w-2.5 h-px bg-border shrink-0" />}
            <span
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[length:var(--text-2xs)] transition-colors ${
                done
                  ? "bg-accent-soft text-accent"
                  : active
                    ? "bg-accent text-text-inverse"
                    : "bg-surface-alt text-text-muted"
              }`}
            >
              {done ? (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              ) : active ? (
                <svg className="w-2.5 h-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                  <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50" />
              )}
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
