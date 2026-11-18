import { uiText, useUiLocale } from "../../lib/i18n";

export function DialogCloseButton({ onClick, disabled }: {
  onClick: () => void;
  disabled?: boolean;
}): JSX.Element {
  useUiLocale();
  return <button type="button" className="dialog-close-button no-drag" aria-label={uiText("common.close")}
    onClick={onClick} disabled={disabled}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <path d="M3.5 3.5l9 9m0-9-9 9" />
    </svg>
  </button>;
}
