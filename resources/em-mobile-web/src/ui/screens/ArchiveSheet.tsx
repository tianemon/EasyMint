import type { SessionListItem } from '../../protocol/types';
import { Icon } from '../components/icons';
import { t } from '../i18n';

export function ArchiveSheet({ visible, sessions, onClose, onRestore }: {
  visible: boolean;
  sessions: SessionListItem[];
  onClose: () => void;
  onRestore: (item: SessionListItem) => void;
}): React.ReactElement | null {
  if (!visible) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <span className="sheet-title">{t('app.archive')}</span>
          <button type="button" className="sheet-close" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="sheet-body">
          {sessions.length === 0 && <div className="empty-hint">没有归档的会话</div>}
          {sessions.map((item, index) => (
            <div key={item.sessionId} className="sheet-row">
              {index > 0 && <span className="sheet-divider" />}
              <span className="sheet-row-title">{item.title || '新会话'}</span>
              <button type="button" className="sheet-row-action" onClick={() => onRestore(item)}>恢复</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
