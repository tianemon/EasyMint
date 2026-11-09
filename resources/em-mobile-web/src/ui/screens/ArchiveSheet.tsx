import type { SessionListItem } from '../../protocol/types';
import { formatSessionTime } from '../../core/session-time';
import { Glass } from '../components/Glass';

/** 归档会话弹层：抓手 + 「已归档 / N 个会话」+ 行内「恢复」按钮。 */
export function ArchiveSheet({ visible, sessions, onClose, onRestore }: {
  visible: boolean;
  sessions: SessionListItem[];
  onClose: () => void;
  onRestore: (item: SessionListItem) => void;
}): React.ReactElement | null {
  if (!visible) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <Glass variant="frosted" radius={24} blur className="archive-sheet">
        <div className="archive-sheet-inner" onClick={(event) => event.stopPropagation()}>
          <div className="sheet-grip" />
          <div className="archive-head">
            <span className="archive-title">已归档</span>
            <span className="archive-count">{sessions.length} 个会话</span>
          </div>
          <div className="archive-list">
            {sessions.length === 0 && <div className="archive-empty">没有已归档的会话</div>}
            {sessions.map((item, index) => (
              <div key={item.sessionId} className="archive-row">
                {index > 0 && <span className="archive-divider" />}
                <div className="archive-row-main">
                  <div className="archive-row-title">{item.title || '未命名会话'}</div>
                  <div className="archive-row-time">归档于 {formatSessionTime(item.archivedAt ?? item.updatedAt)}</div>
                </div>
                <button type="button" className="archive-restore" onClick={() => onRestore(item)}>恢复</button>
              </div>
            ))}
          </div>
        </div>
      </Glass>
    </div>
  );
}
