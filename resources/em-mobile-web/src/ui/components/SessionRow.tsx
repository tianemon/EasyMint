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
  const startPress = (): void => { timer.current = setTimeout(onMenu, 550); };
  const endPress = (): void => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const preview = session.lastMessage?.replace(/\s+/g, ' ').trim();
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
      {!first && <span className="session-divider" />}
      <span className="session-main">
        <span className="session-title">{session.title || '新会话'}</span>
        {preview && <span className="session-preview">{preview}</span>}
      </span>
      {session.updatedAt && <span className="session-time">{formatSessionTime(session.updatedAt)}</span>}
    </button>
  );
}
