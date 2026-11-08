import { useState } from 'react';
import type { DisplayMessage } from '../../core/messages';
import { ALWAYS_EXPANDED_KINDS, RESULT_KINDS, RESULT_ROW_RE, authLinkFromRow, statusTone } from '../../core/system-status';
import { SYSTEM_LABELS } from '../../core/tools';
import { Icon } from './icons';

/** 系统卡：error/system 常展开；结果型（delegation/shell/human-action）默认折叠，展开看全文。 */
export function SystemCard({ message }: { message: DisplayMessage }): React.ReactElement {
  const kind = message.systemKind ?? 'system';
  const alwaysOpen = ALWAYS_EXPANDED_KINDS.has(kind) || RESULT_KINDS.has(kind) === false;
  const [open, setOpen] = useState(alwaysOpen);
  const label = SYSTEM_LABELS[kind] ?? '系统消息';
  const text = message.text ?? '';
  const firstLine = text.split('\n')[0] ?? '';
  const rowMatch = RESULT_ROW_RE.exec(firstLine.trim());
  const tone = message.systemTone ?? (kind === 'error' ? 'error' : 'warn');
  const status = rowMatch ? rowMatch[2] : undefined;
  const statusCls = statusTone(status);

  return (
    <div className={`system-card tone-${tone} kind-${kind}`}>
      <button type="button" className="system-head" onClick={() => setOpen((value) => !value)}>
        <Icon name={kind === 'error' ? 'alert' : kind === 'shell' ? 'bash' : 'system'} size={13} />
        <span className="system-label">{rowMatch ? rowMatch[1] : label}</span>
        {status && <span className={`system-status status-${statusCls}`}>{status}</span>}
        {rowMatch?.[3] && <span className="system-duration">{rowMatch[3]}s</span>}
        <Icon name={open ? 'chevronDown' : 'chevron'} size={12} />
      </button>
      {open && (
        <div className="system-body">
          {text.split('\n').map((row, index) => {
            const link = authLinkFromRow(row);
            return link
              ? <a key={index} className="system-auth-link" href={link.url} target="_blank" rel="noopener noreferrer">{link.label}：打开链接</a>
              : <div key={index} className="system-row">{row || ' '}</div>;
          })}
          {message.systemHint && <div className="system-hint">{message.systemHint}</div>}
        </div>
      )}
    </div>
  );
}
