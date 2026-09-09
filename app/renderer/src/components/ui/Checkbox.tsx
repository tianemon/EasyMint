/**
 * 自绘复选框 —— 全项目勾选控件的唯一形态。
 *
 * 为什么不用原生 checkbox:原生控件由系统绘制(各 OS/主题下观感不一),且只能靠
 * `accent-color` 微调,做不出 EM 的语义色分层与半选态样式。
 *
 * 语义仍是表单控件(button + role="checkbox" + aria-checked),键盘可达;
 * 点击一律 stopPropagation——行内勾选场景(文件树/传输列表)点框不能触发行 onClick。
 * checked=null = 半选(如父目录下仅部分文件被选中)。
 */

export function Checkbox({ checked, onChange, disabled, className, ariaLabel }: {
  /** 选中态;null = 半选 */
  checked: boolean | null;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  const on = checked === true;
  const mixed = checked === null;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : on}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${
        on || mixed
          ? "bg-accent border-accent text-text-inverse"
          : "bg-surface border-border hover:border-accent-border-strong"
      } ${className ?? ""}`}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!on);
      }}
    >
      {mixed ? (
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M1.6 4h4.8" />
        </svg>
      ) : on ? (
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.8 5.2l2.1 2.1L8.2 2.9" />
        </svg>
      ) : null}
    </button>
  );
}
