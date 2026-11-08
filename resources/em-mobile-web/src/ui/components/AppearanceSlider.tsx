import type { ThemeMode } from '../theme';
import { t } from '../i18n';
import { Glass } from './Glass';
import { AppearanceIcon } from './icons';

/** 顺序照 App：浅色 / 深色 / 自动 */
const OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: 'light', label: t('app.themeLight') },
  { value: 'dark', label: t('app.themeDark') },
  { value: 'system', label: '自动' },
];

/** 外观分段滑块：全宽 54 高磨砂轨道 + 第二层磨砂选中块（照 App AppearanceSlider）。 */
export function AppearanceSlider({ value, onChange }: {
  value: ThemeMode;
  onChange: (value: ThemeMode) => void;
}): React.ReactElement {
  const index = Math.max(0, OPTIONS.findIndex((item) => item.value === value));
  return (
    <div className="appearance-slider" role="radiogroup" aria-label={t('app.appearance')}>
      <Glass variant="frosted" radius={27} className="appearance-track">
        <div className="segment-thumb" style={{ transform: `translateX(${index * 100}%)` }}>
          <Glass variant="frosted" radius={23} blur className="segment-thumb-fill" />
        </div>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`segment-option${value === option.value ? ' is-selected' : ''}`}
            onClick={() => onChange(option.value)}
          >
            <AppearanceIcon mode={option.value} size={17} />
            <span>{option.label}</span>
          </button>
        ))}
      </Glass>
    </div>
  );
}
