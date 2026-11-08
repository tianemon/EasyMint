import type { ReactNode } from 'react';
import { Icon } from './icons';
import { t } from '../i18n';

/** 页面标题栏：左返回 / 中标题（字符串或自定义节点）/ 右操作。左右各固定 88，标题居中。 */
export function Header({ title, onBack, right }: {
  title: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
}): React.ReactElement {
  return (
    <header className="header">
      <div className="header-side header-left">
        {onBack && (
          <button type="button" className="header-back" onClick={onBack}>
            <Icon name="back" size={14} />
            <span>{t('app.back')}</span>
          </button>
        )}
      </div>
      <div className="header-title">
        {typeof title === 'string' ? <span className="header-title-text">{title}</span> : title}
      </div>
      <div className="header-side header-right">{right}</div>
    </header>
  );
}
