import { useState } from 'react';
import type { ProcessItem, TurnPiece, TurnView as TurnData } from '../../core/turns';
import { formatTurnDuration, turnMode } from '../../core/turns';
import { formatUsage } from '../../core/messages';
import { Icon, toolIconName } from './icons';
import { ToolCard } from './ToolCard';
import { MarkdownView } from './markdown/MarkdownView';

function ThinkingBlock({ text, running }: { text: string; running: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking-block">
      <button type="button" className="thinking-head" onClick={() => setOpen((value) => !value)}>
        <Icon name="think" size={13} />
        <span>思考过程</span>
        {running && <span className="thinking-running">…</span>}
        <Icon name={open ? 'chevronDown' : 'chevron'} size={11} />
      </button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}

function ProcessItems({ items, running, live }: { items: ProcessItem[]; running: boolean; live: boolean }): React.ReactElement {
  return (
    <div className="turn-process-items">
      {items.map((item) => {
        if (item.kind === 'thinking') return <ThinkingBlock key={item.key} text={item.text} running={item.running} />;
        if (item.kind === 'commentary') return <MarkdownView key={item.key} text={item.text} />;
        return <ToolCard key={item.key} tool={item.tool} live={live} />;
      })}
      {running && <span className="turn-process-running" />}
    </div>
  );
}

function TextPiece({ piece, active }: { piece: Extract<TurnPiece, { kind: 'text' }>; active: boolean }): React.ReactElement {
  // 流式期间最后一条正文用轻量纯文本预览；turn_end 后（active=false）在 rAF 内切 Markdown 富渲染。
  if (piece.tail && active) return <div className="plain-preview">{piece.text}</div>;
  return <MarkdownView text={piece.text} />;
}

/** 三态回合视图：running（摘要+流式）/ folded（240px 有界折叠）/ flat（过程摊开）。 */
export function TurnView({ turn }: { turn: TurnData }): React.ReactElement {
  const mode = turnMode(turn);
  const [expanded, setExpanded] = useState(false);
  const duration = formatTurnDuration(turn.durationMs, { active: turn.active, interrupted: turn.interrupted });
  const processPieces = turn.pieces.filter((piece): piece is Extract<TurnPiece, { kind: 'process' }> => piece.kind === 'process');
  const textPieces = turn.pieces.filter((piece): piece is Extract<TurnPiece, { kind: 'text' }> => piece.kind === 'text');
  const conclusions = turn.conclusion;

  const processBlock = (bounded: boolean): React.ReactElement => (
    <div className={`turn-process${bounded ? ' is-bounded' : ''}${expanded ? ' is-expanded' : ''}`}>
      {processPieces.map((piece) => <ProcessItems key={piece.key} items={piece.items} running={piece.running} live={turn.active} />)}
    </div>
  );

  return (
    <div className={`turn turn-${mode}`}>
      {mode === 'running' && (
        <>
          {turn.processCount > 0 && (
            <button type="button" className="turn-proc-head" onClick={() => setExpanded((value) => !value)}>
              <Icon name={toolIconName(turn.iconName)} size={13} />
              <span className="turn-summary">{turn.summary}</span>
              <span className="turn-live-dot" />
              <Icon name={expanded ? 'chevronDown' : 'chevron'} size={11} />
            </button>
          )}
          {expanded && processBlock(true)}
        </>
      )}

      {mode === 'folded' && (
        <>
          {/* App 的折叠行只有「用时 X分钟 Y秒 ›」：过程摘要仅在运行中出现，
              结束后不再重复（否则同一句话会在正文上方再占一条带底色的行） */}
          <button type="button" className="turn-fold-head" onClick={() => setExpanded((value) => !value)}>
            <span className="turn-duration">{duration}</span>
            <Icon name={expanded ? 'chevronDown' : 'chevron'} size={11} />
          </button>
          {expanded && processBlock(true)}
        </>
      )}

      {mode === 'flat' && processPieces.length > 0 && processBlock(false)}

      {/* 过程中夹的正文（running / flat 保留交错顺序） */}
      {(mode === 'running' || mode === 'flat') && textPieces.map((piece) => (
        <TextPiece key={piece.key} piece={piece} active={turn.active} />
      ))}

      {conclusions.map((item) => <MarkdownView key={item.key} text={item.text} />)}

      {turn.usage && <div className="turn-usage">{formatUsage(turn.usage)}</div>}
    </div>
  );
}
