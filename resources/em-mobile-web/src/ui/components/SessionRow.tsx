import { useRef } from 'react';
import type { SessionListItem } from '../../protocol/types';
import { formatSessionTime } from '../../core/session-time';

/** 会话行：无边框、无图标的纯文本行，行间用绝对定位、左右内缩 chatInset 的 hairline（照 App SessionRow）。 */
export function SessionRow({ session, first, onOpen, onMenu }: {
  session: SessionListItem;
  first?: boolean;
  onOpen: () => void;
  onMenu: () => void;
}): React.ReactElement {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const startPress = (): void => {
    longPressed.current = false;
    timer.current = setTimeout(() => { longPressed.current = true; onMenu(); }, 450);
  };
  const endPress = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const preview = session.lastMessage?.replace(/\s+/g, ' ').trim();
  return (
    <button
      type="button"
      className="session-row"
      onClick={() => { if (!longPressed.current) onOpen(); }}
      onTouchStart={startPress}
      onTouchEnd={endPress}
      onTouchMove={endPress}
      onMouseDown={startPress}
      onMouseUp={endPress}
      onMouseLeave={endPress}
    >
      {!first && <span className="session-divider" />}
      <span className="session-main">
        <span className="session-title">{session.title || '未命名会话'}</span>
        <span className="session-preview">{preview || `${session.messageCount ?? 0} 条消息`}</span>
      </span>
      {session.updatedAt && <span className="session-time">{formatSessionTime(session.updatedAt)}</span>}
    </button>
  );
}
