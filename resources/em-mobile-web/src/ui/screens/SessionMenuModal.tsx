import type { SessionListItem } from '../../protocol/types';
import { Glass } from '../components/Glass';

/** 长按会话行弹出的会话操作弹层（重命名 / 置顶 / 归档）。标题固定「会话操作」。 */
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
  const saveDisabled = !renameTitle.trim() || renameTitle.trim() === session.title;
  return (
    <div className="sheet-backdrop" onClick={onDismiss}>
      <Glass variant="frosted" radius={20} blur className="session-menu">
        <div className="session-menu-inner" onClick={(event) => event.stopPropagation()}>
          <div className="session-menu-title">会话操作</div>
          <div className="session-menu-body">
            <input className="session-menu-input" value={renameTitle} placeholder="会话标题"
              onChange={(event) => onRenameTitleChange(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !saveDisabled) onRename(); }} />
            <button type="button" className="menu-button is-secondary" disabled={saveDisabled} onClick={onRename}>保存标题</button>
            <button type="button" className="menu-button is-secondary" onClick={onTogglePin}>
              {session.pinnedAt ? '取消置顶' : '置顶会话'}
            </button>
            <button type="button"
              className={`menu-button${session.archivedAt ? ' is-secondary' : ' is-danger'}`}
              onClick={onToggleArchive}>
              {session.archivedAt ? '恢复会话' : '归档会话'}
            </button>
          </div>
        </div>
      </Glass>
    </div>
  );
}
