import type { SessionListItem } from '../../protocol/types';
import { Icon } from '../components/icons';
import { t } from '../i18n';

export function SessionMenuModal({ visible, session, renameTitle, onRenameTitleChange, onDismiss,
  onRequestClose, onRename, onTogglePin, onToggleArchive }: {
  visible: boolean;
  session: SessionListItem | null;
  renameTitle: string;
  onRenameTitleChange: (value: string) => void;
  onDismiss: () => void;
  onRequestClose: () => void;
  onRename: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
}): React.ReactElement | null {
  if (!visible || !session) return null;
  return (
    <div className="sheet-backdrop" onClick={onDismiss}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <span className="sheet-title">{session.title || '新会话'}</span>
          <button type="button" className="sheet-close" onClick={onRequestClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="sheet-body">
          <div className="sheet-rename">
            <input value={renameTitle} onChange={(event) => onRenameTitleChange(event.target.value)}
              placeholder="会话名称" onKeyDown={(event) => { if (event.key === 'Enter') onRename(); }} />
            <button type="button" onClick={onRename}>重命名</button>
          </div>
          <button type="button" className="sheet-action" onClick={onTogglePin}>
            <Icon name="pin" size={15} /> {session.pinnedAt ? '取消置顶' : '置顶会话'}
          </button>
          <button type="button" className="sheet-action" onClick={onToggleArchive}>
            <Icon name="archive" size={15} /> {session.archivedAt ? '恢复会话' : t('app.archive')}
          </button>
        </div>
      </div>
    </div>
  );
}
