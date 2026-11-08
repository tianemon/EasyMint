import type { ThemeMode } from '../theme';
import { t } from '../i18n';

const OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' },
  { value: 'dark', label: '深色' },
];

/** 外观分段滑块：轨道 + 滑块（结构取自 EasyEdit，色值按 tokens 中性灰校准）。 */
export function AppearanceSlider({ value, onChange }: {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
}): React.ReactElement {
  const index = Math.max(0, OPTIONS.findIndex((item) => item.value === value));
  return (
    <div className="appearance-slider" role="radiogroup" aria-label={t('app.appearance')}>
      <div className="segment-thumb" style={{ transform: `translateX(${index * 100}%)` }} />
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`segment-option${value === option.value ? ' is-selected' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.value === 'light' ? t('app.themeLight') : option.value === 'dark' ? t('app.themeDark') : t('app.themeSystem')}
        </button>
      ))}
    </div>
  );
}
