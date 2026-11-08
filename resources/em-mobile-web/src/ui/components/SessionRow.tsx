import { useRef } from 'react';
import type { SessionListItem } from '../../protocol/types';
import { formatSessionTime } from '../../core/session-time';
import { Icon } from './icons';

/** 会话行：左侧内缩 hairline 与聊天区 chatInset 对齐；长按/右键打开会话菜单。 */
export function SessionRow({ session, onOpen, onMenu }: {
  session: SessionListItem;
  onOpen: () => void;
  onMenu: () => void;
}): React.ReactElement {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPress = (): void => { timer.current = setTimeout(onMenu, 550); };
  const endPress = (): void => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return (
    <button
      type="button"
      className="session-row"
      onClick={() => { if (timer.current) return; onOpen(); }}
      onContextMenu={(event) => { event.preventDefault(); onMenu(); }}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchMove={endPress}
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
    >
      <span className="session-hairline" />
      <span className="session-main">
        <span className="session-title-line">
          {session.pinnedAt && <Icon name="pin" size={12} />}
          <span className="session-title">{session.title || '新会话'}</span>
          {session.updatedAt && <span className="session-time">{formatSessionTime(session.updatedAt)}</span>}
        </span>
        {session.lastMessage && <span className="session-preview">{session.lastMessage}</span>}
      </span>
      <Icon name="chevron" size={15} />
    </button>
  );
}
