import type { ReactNode } from 'react';
import { Icon } from './icons';
import { t } from '../i18n';

export function Header({
  title,
  onBack,
  onTitleClick,
  showTitleChevron = false,
  connected,
  right,
  rightLabel,
  onRight,
}: {
  title: ReactNode;
  onBack?: () => void;
  onTitleClick?: () => void;
  showTitleChevron?: boolean;
  connected?: boolean;
  right?: ReactNode;
  rightLabel?: string;
  onRight?: () => void;
}): React.ReactElement {
  return (
    <header className="header">
      <div className="header-side header-left">
        {onBack && (
          <button type="button" className="header-back" onClick={onBack}>
            <Icon name="back" size={17} />
            <span>{t('app.back')}</span>
          </button>
        )}
      </div>
      <button
        type="button"
        className={`header-title${onTitleClick ? ' is-clickable' : ''}`}
        onClick={onTitleClick}
        disabled={!onTitleClick}
      >
        {showTitleChevron && <Icon name="chevronDown" size={15} />}
        <span className="header-title-text">{title}</span>
        {connected !== undefined && <span className={`header-dot${connected ? ' is-on' : ''}`} />}
      </button>
      <div className="header-side header-right">
        {right ?? (onRight && (
          <button type="button" className="header-action" onClick={onRight}>{rightLabel}</button>
        ))}
      </div>
    </header>
  );
}
