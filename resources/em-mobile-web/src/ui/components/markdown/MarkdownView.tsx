import { memo, useMemo } from 'react';
import type { Token } from 'marked';
import { lexMarkdown, splitMarkdownParts, splitStableBlocks } from '../../../core/markdown/parse';
import type { MarkdownPart } from '../../../core/markdown/parse';
import { InlineTokens } from './inline';
import { CodeBlock } from './CodeBlock';

type Loose = Record<string, unknown>;
const loose = (token: Token): Loose => token as unknown as Loose;

function BlockToken({ token, keyPrefix }: { token: Token; keyPrefix: string }): React.ReactElement | null {
  const t = loose(token);
  const inner = (t.tokens ?? []) as Token[];
  switch (token.type) {
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(t.depth ?? 1)));
      const Tag = `h${level}` as 'h1';
      return <Tag className="md-heading"><InlineTokens tokens={inner} keyPrefix={keyPrefix} /></Tag>;
    }
    case 'paragraph':
      return <p className="md-paragraph"><InlineTokens tokens={inner} keyPrefix={keyPrefix} /></p>;
    case 'text':
      return <p className="md-paragraph"><InlineTokens tokens={(t.tokens ?? []) as Token[]} keyPrefix={keyPrefix} /></p>;
    case 'blockquote':
      return <blockquote className="md-quote"><InlineTokens tokens={inner} keyPrefix={keyPrefix} /></blockquote>;
    case 'code':
      return <CodeBlock lang={String(t.lang ?? 'TEXT')} code={String(t.text ?? '')} />;
    case 'list': {
      const ordered = Boolean(t.ordered);
      const items = (t.items ?? []) as Token[];
      const ListTag = ordered ? 'ol' : 'ul';
      return (
        <ListTag className="md-list" start={ordered ? Number(t.start ?? 1) : undefined}>
          {items.map((item, index) => {
            const it = loose(item);
            const itemTokens = (it.tokens ?? []) as Token[];
            return <li key={`${keyPrefix}-li-${index}`}><InlineTokens tokens={itemTokens} keyPrefix={`${keyPrefix}-li-${index}`} /></li>;
          })}
        </ListTag>
      );
    }
    case 'hr':
      return <hr className="md-hr" />;
    case 'space':
      return null;
    case 'table': {
      const header = (t.header ?? []) as Token[];
      const rows = (t.rows ?? []) as Token[][];
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{header.map((cell, i) => {
              const c = loose(cell);
              return <th key={i}><InlineTokens tokens={(c.tokens ?? []) as Token[]} keyPrefix={`${keyPrefix}-th-${i}`} /></th>;
            })}</tr></thead>
            <tbody>{rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => {
                const c = loose(cell);
                return <td key={j}><InlineTokens tokens={(c.tokens ?? []) as Token[]} keyPrefix={`${keyPrefix}-td-${i}-${j}`} /></td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
      );
    }
    case 'html':
      return null;
    default:
      return inner.length ? <div className="md-paragraph"><InlineTokens tokens={inner} keyPrefix={keyPrefix} /></div> : null;
  }
}

/** 单个已完成块：文本不变时 memo 住 marked 解析结果（流式重解析规避）。 */
const StableBlock = memo(function StableBlock({ text, prefix }: { text: string; prefix: string }): React.ReactElement {
  const tokens = useMemo(() => lexMarkdown(text), [text]);
  return (
    <div className="md-block">
      {tokens.map((token, index) => <BlockToken key={`${prefix}-${index}`} token={token} keyPrefix={`${prefix}-${index}`} />)}
    </div>
  );
});

function MarkdownPartView({ part, streaming, prefix }: {
  part: MarkdownPart; streaming: boolean; prefix: string;
}): React.ReactElement {
  if (part.kind === 'code') return <CodeBlock lang={part.lang} code={part.code} />;
  const blocks = useMemo(
    () => streaming ? splitStableBlocks(part.text) : [part.text],
    [part.text, streaming],
  );
  return (
    <div className="md-part">
      {blocks.map((block, index) => (
        <StableBlock key={`${prefix}-b-${index}`} text={block} prefix={`${prefix}-b-${index}`} />
      ))}
    </div>
  );
}

/**
 * 流式期间最后一条正文由 TurnView 走纯文本预览；这里只负责「已完成 / 非流式」的富渲染，
 * turn_end 后由 MessageList 在 rAF 内切换过来并保持贴底。
 */
export const MarkdownView = memo(function MarkdownView({ text, streaming = false }: {
  text: string; streaming?: boolean;
}): React.ReactElement {
  const parts = useMemo(() => splitMarkdownParts(text, streaming), [text, streaming]);
  return (
    <div className="markdown">
      {parts.map((part, index) => (
        <MarkdownPartView key={index} part={part} streaming={streaming} prefix={`p${index}`} />
      ))}
    </div>
  );
});
