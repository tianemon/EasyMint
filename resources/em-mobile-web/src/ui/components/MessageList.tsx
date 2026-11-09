import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DisplayMessage } from '../../core/messages';
import { buildRows } from '../../core/turns';
import type { DisplayRow } from '../../core/turns';
import { describeProcessItem } from '../../core/tools';
import { MintStatus } from './MintStatus';
import { SystemCard } from './SystemCard';
import { TurnView } from './TurnView';

const USER_MAX_LINES = 12;
const CHARS_PER_LINE = 18;
const AT_BOTTOM_PX = 24;

function needsScroll(text: string): boolean {
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    lines += Math.max(1, Math.ceil(paragraph.length / CHARS_PER_LINE));
    if (lines > USER_MAX_LINES) return true;
  }
  return false;
}

function UserBubble({ message }: { message: DisplayMessage }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const attachments = message.attachments ?? [];
  const long = !!message.text && needsScroll(message.text);
  const flags = !!message.outOfContext || !!message.imageStripped || !!message.imagesPathOnly;
  return (
    <div className="user-bubble-wrap">
      <div className="user-bubble">
        {attachments.length > 0 && (
          <div className="user-attachments">
            {attachments.map((item) => item.kind === 'image' && item.data
              ? <img key={item.id} className="user-attachment-image"
                src={`data:${item.mimeType ?? 'image/jpeg'};base64,${item.data}`} alt={item.name} />
              : <div key={item.id} className="user-attachment-doc"><span>{item.name}</span></div>)}
          </div>
        )}
        {!!message.text && (
          <div className={`user-text${long && !expanded ? ' is-clamped' : ''}`}>{message.text}</div>
        )}
        {long && (
          <button type="button" className="user-expand" onClick={() => setExpanded((value) => !value)}>
            {expanded ? '收起' : '展开全文'}
          </button>
        )}
      </div>
      {flags && (
        <div className="user-badges">
          {!!message.outOfContext && <span className="user-badge">已退出上下文</span>}
          {!!message.imageStripped && !message.outOfContext && <span className="user-badge">历史图片已整理</span>}
          {!!message.imagesPathOnly && <span className="user-badge">图片仅传路径</span>}
        </div>
      )}
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

export function MessageList({ messages, running, tail, askId, statusText, statusIcon,
  bottomInset = 0, topInset = 0 }: {
  messages: DisplayMessage[];
  running: boolean;
  tail?: ReactNode;
  askId?: string;
  statusText?: string;
  statusIcon?: string;
  bottomInset?: number;
  /** 数字按 px；字符串原样用于 calc（聊天页要带上 env(safe-area-inset-top)） */
  topInset?: number | string;
}): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const forceBottom = useRef(true);
  const followingBottom = useRef(true);

  // 最新在前 → 文档流要 oldest-first
  const rows = useMemo(
    () => buildRows(messages, running, describeProcessItem).slice().reverse(),
    [messages, running],
  );
  // 状态行只在没有正在跑的过程时出现（有 live 过程由回合行承担）
  const liveTurn = rows.find((row) => row.kind === 'turn' && row.turn.active);
  const showStatus = !!statusText && !(liveTurn?.kind === 'turn' && liveTurn.turn.processCount > 0);

  const signature = `${messages.length}:${messages[0]?.id ?? ''}:${messages[0]?.streaming ? 1 : 0}`;
  useLayoutEffect(() => {
    if (!askId) return;
    forceBottom.current = true;
    followingBottom.current = true;
    setAtBottom(true);
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
    forceBottom.current = false;
  }, [askId]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (!atBottom && !forceBottom.current) return;
    // Layout effects run before paint, so opening a populated session does not flash at the top.
    node.scrollTop = node.scrollHeight;
    forceBottom.current = false;
  }, [signature, rows, atBottom, bottomInset, statusText]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    const column = node?.firstElementChild;
    if (!node || !column || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (followingBottom.current || forceBottom.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(column);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el || forceBottom.current) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
    followingBottom.current = bottom;
    setAtBottom(bottom);
  };

  const vars = {
    '--msg-top': typeof topInset === 'number' ? `${topInset + 8}px` : `calc(${topInset} + 8px)`,
    '--msg-bottom': `${bottomInset + 12}px`,
  } as CSSProperties;

  return (
    <div className="message-area" style={vars}>
      <div className="message-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="message-column">
          {rows.map((row) => <div className="msg-row" data-liquid-row="" key={row.key}><Row row={row} /></div>)}
          <div className="message-tail">
            {tail}
            {showStatus && <MintStatus text={statusText!} icon={statusIcon} />}
          </div>
        </div>
      </div>
    </div>
  );
}
