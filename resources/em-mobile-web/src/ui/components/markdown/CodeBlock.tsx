import { useState } from 'react';
import { Icon } from '../icons';

export function CodeBlock({ lang, code }: { lang: string; code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  };
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-lang">{lang}</span>
        <button type="button" className="code-copy" onClick={copy} aria-label="复制代码">
          <Icon name={copied ? 'check' : 'copy'} size={13} />
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className="code-body"><code>{code}</code></pre>
    </div>
  );
}
