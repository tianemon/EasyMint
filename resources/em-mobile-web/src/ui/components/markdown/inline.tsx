import type { ReactNode } from 'react';
import type { Token } from 'marked';
import { decodeEntities, safeHref } from '../../../core/markdown/parse';
import { Icon } from '../icons';

type Loose = Record<string, unknown>;
const loose = (token: Token): Loose => token as unknown as Loose;

function children(token: Token, keyPrefix: string): ReactNode {
  const list = (loose(token).tokens ?? []) as Token[];
  return <InlineTokens tokens={list} keyPrefix={keyPrefix} />;
}

/** 行内 token → React 节点。不用 dangerouslySetInnerHTML：CSP 无 unsafe-inline，且避免原始 HTML 注入。 */
export function InlineTokens({ tokens, keyPrefix = 'i' }: { tokens: Token[]; keyPrefix?: string }): React.ReactElement {
  return (
    <>
      {tokens.map((token, index) => {
        const t = loose(token);
        const key = `${keyPrefix}-${index}`;
        switch (token.type) {
          case 'text':
          case 'escape':
            return <span key={key}>{decodeEntities(String(t.text ?? t.raw ?? ''))}</span>;
          case 'strong':
            return <strong key={key}>{children(token, key)}</strong>;
          case 'em':
            return <em key={key}>{children(token, key)}</em>;
          case 'del':
            return <del key={key}>{children(token, key)}</del>;
          case 'codespan':
            return <code key={key} className="md-inline-code">{String(t.text ?? '')}</code>;
          case 'br':
            return <br key={key} />;
          case 'space':
            return <span key={key}> </span>;
          case 'link': {
            const href = safeHref(String(t.href ?? ''));
            const label = children(token, key);
            return href
              ? <a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}<Icon name="link" size={11} /></a>
              : <span key={key}>{label}</span>;
          }
          case 'image': {
            const href = safeHref(String(t.href ?? ''));
            return href
              ? <img key={key} className="md-image" src={href} alt={String(t.text ?? '')} />
              : <span key={key} className="md-image-fallback">{String(t.text ?? '图片')}</span>;
          }
          case 'html':
            // 原始 HTML 一律不渲染（安全 + CSP）：只把可见文字提出来。
            return <span key={key}>{decodeEntities(String(t.text ?? t.raw ?? ''))}</span>;
          default:
            return t.tokens ? <span key={key}>{children(token, key)}</span> : null;
        }
      })}
    </>
  );
}
