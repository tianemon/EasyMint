import { useState } from 'react';
import type { DisplayMessage } from '../../core/messages';
import { ALWAYS_EXPANDED_KINDS, RESULT_KINDS, RESULT_ROW_RE, authLinkFromRow, statusTone } from '../../core/system-status';
import { SYSTEM_LABELS } from '../../core/tools';
import { ChevronIcon, SystemKindIcon, iconSize } from './icons';
import { MarkdownView } from './markdown/MarkdownView';

/** 正文行高（PC 的 leading-[1.55]） */
const BODY_LINE_HEIGHT = 14 * 1.55;
/** 结果卡展开限高：约 6 行；摘要限高 16 行 */
const RESULT_BODY_MAX_HEIGHT = BODY_LINE_HEIGHT * 6 + 0.5;
const SUMMARY_BODY_MAX_HEIGHT = 22 * 16 + 0.5;
const LOG_PATH_RE = /^完整输出:\s*(\S.*)$/;

/**
 * 系统消息卡：kind 图标 + 状态点 + 标签 +「- 状态 · Ns」；展开看正文。
 * 与 App SystemCard.tsx 同序、同三档色（failed=fail / interrupt=interrupt / done=done），无描边。
 */
export function SystemCard({ message }: { message: DisplayMessage }): React.ReactElement {
  const kind = message.systemKind ?? 'system';
  const body = (message.text ?? '').replace(/^\[系统消息\](-\[[^\]]*\])?\s*/, '');
  const lines = body.split('\n');
  const firstDotIndex = lines.findIndex((line) => line.startsWith('⏺ '));
  const status = firstDotIndex >= 0 ? lines[firstDotIndex]?.match(RESULT_ROW_RE) : null;
  const isResult = RESULT_KINDS.has(kind);
  const isSummary = kind === 'summary';
  const collapsible = !ALWAYS_EXPANDED_KINDS.has(kind);
  const [open, setOpen] = useState(!collapsible);
  const showBody = (!collapsible || open) && !!body;
  const tone = statusTone(status?.[2]);
  const toneClass = `is-${tone}`;
  const isError = kind === 'error';

  return (
    <div className="system-card">
      <button type="button" className="system-head" disabled={!collapsible}
        onClick={() => setOpen((value) => !value)}>
        <SystemKindIcon kind={kind} color={isError ? (message.systemTone === 'warn' ? 'var(--warning)' : 'var(--danger)') : undefined} />
        {!!status && <span className={`system-status-dot ${toneClass}`} aria-hidden="true" />}
        <span className="system-label">{SYSTEM_LABELS[kind] ?? '系统消息'}</span>
        {!!status && (
          <span className="system-status">
            - <span className={toneClass}>{status[2]}</span>{status[3] ? ` · ${status[3]}s` : ''}
          </span>
        )}
        {collapsible && <ChevronIcon size={iconSize.nav} direction={open ? 'down' : 'right'} className="system-chevron" />}
      </button>

      {showBody && (isResult
        ? (
          <div className="system-result-body" style={{ maxHeight: RESULT_BODY_MAX_HEIGHT }}>
            {lines.map((row, index) => {
              if (index === firstDotIndex) return null;
              const logPath = LOG_PATH_RE.exec(row);
              if (logPath) return <div key={index} className="system-log-path">{logPath[1]}</div>;
              const authLink = authLinkFromRow(row);
              if (authLink) {
                return (
                  <a key={index} className="system-auth-link" href={authLink.url}
                    target="_blank" rel="noopener noreferrer">{authLink.label}: {authLink.url}</a>
                );
              }
              const parsed = row.startsWith('⏺ ') ? row.match(RESULT_ROW_RE) : null;
              if (!parsed) {
                return row.trim() === '' ? null
                  : <div key={index} className="system-body-line">{row.replace(/^⏺(?=\s)/, '●')}</div>;
              }
              return (
                <div key={index} className="system-body-line">
                  <span className={`system-inline-dot ${statusTone(parsed[2]) === 'failed' ? 'is-failed' : statusTone(parsed[2]) === 'interrupt' ? 'is-interrupt' : 'is-done'}`}>● </span>
                  <span className="system-result-name">{parsed[1]}</span>
                  <span className="system-result-status">
                    {' - '}
                    <span className={statusTone(parsed[2]) === 'failed' ? 'is-failed' : statusTone(parsed[2]) === 'interrupt' ? 'is-interrupt' : 'is-done'}>{parsed[2]}</span>
                  </span>
                  {parsed[3] ? <span className="system-duration"> • {parsed[3]}s</span> : null}
                </div>
              );
            })}
          </div>
        )
        : isSummary
          ? (
            <div className="system-summary-body" style={{ maxHeight: SUMMARY_BODY_MAX_HEIGHT }}>
              <MarkdownView text={body} />
            </div>
          )
          : (
            <div className="system-plain-body">
              <div className="system-body-text">{body}</div>
              {!!message.systemHint && <div className="system-hint">{message.systemHint}</div>}
            </div>
          ))}
    </div>
  );
}
