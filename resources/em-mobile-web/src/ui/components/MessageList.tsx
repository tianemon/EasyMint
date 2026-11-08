import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DisplayMessage } from '../../core/messages';
import { buildRows } from '../../core/turns';
import type { DisplayRow } from '../../core/turns';
import { describeProcessItem } from '../../core/tools';
import { Icon } from './icons';
import { SystemCard } from './SystemCard';
import { TurnView } from './TurnView';
import { t } from '../i18n';

function UserBubble({ message }: { message: DisplayMessage }): React.ReactElement {
  const attachments = message.attachments ?? [];
  return (
    <div className="user-bubble-wrap">
      <div className="user-bubble">
        {message.text && <div className="user-text">{message.text}</div>}
        {attachments.length > 0 && (
          <div className="user-attachments">
            {attachments.map((item) => (
              <div key={item.id} className="user-attachment">
                {item.kind === 'image' && item.data
                  ? <img src={`data:${item.mimeType ?? 'image/jpeg'};base64,${item.data}`} alt={item.name} />
                  : <><Icon name={item.kind === 'image' ? 'image' : 'doc'} size={13} /><span>{item.name}</span></>}
              </div>
            ))}
          </div>
        )}
        {message.outOfContext && <div className="user-flag">已退出上下文</div>}
        {message.imagesPathOnly && <div className="user-flag">图片仅传路径</div>}
      </div>
    </div>
  );
}

function Row({ row }: { row: DisplayRow }): React.ReactElement {
  if (row.kind === 'turn') return <TurnView turn={row.turn} />;
  const message = row.message;
  if (message.role === 'user') return <UserBubble message={message} />;
  if (message.role === 'system') return <SystemCard message={message} />;
  return <div className="assistant-plain">{message.text ?? ''}</div>;
}

/** 消息列：普通文档流 + scrollTop 贴底判定 + 未贴底「新消息」按钮 + 行级 content-visibility。 */
export function MessageList({ messages, running, footer }: {
  messages: DisplayMessage[];
  running: boolean;
  footer?: ReactNode;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);
  const lastSignature = useRef('');

  // messages 为「最新在前」，buildRows 同样最新在前；普通文档流要 oldest-first，故反转。
  const rows = useMemo(
    () => buildRows(messages, running, describeProcessItem).slice().reverse(),
    [messages, running],
  );

  const signature = `${messages.length}:${messages[0]?.id ?? ''}:${messages[0]?.streaming ? 1 : 0}`;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (signature !== lastSignature.current) {
      if (!atBottom) setHasNew(true);
      lastSignature.current = signature;
    }
    if (!atBottom) return;
    // turn_end 后 Markdown 富渲染切换与贴底都在 rAF 内完成，避免中间帧抖动。
    const handle = requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
    return () => cancelAnimationFrame(handle);
  }, [signature, rows, atBottom]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAtBottom(bottom);
    if (bottom) setHasNew(false);
  };

  const jumpToBottom = (): void => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setHasNew(false);
    setAtBottom(true);
  };

  return (
    <div className="message-area">
      <div className="message-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="message-column">
          {rows.map((row) => <div className="msg-row" key={row.key}><Row row={row} /></div>)}
          {footer && <div className="message-footer">{footer}</div>}
        </div>
      </div>
      {hasNew && !atBottom && (
        <button type="button" className="new-messages" onClick={jumpToBottom}>
          <Icon name="chevronDown" size={13} /> {t('ui.ChatPanel.newMessages')}
        </button>
      )}
    </div>
  );
}
