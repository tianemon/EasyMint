import { useEffect, useMemo, useState } from 'react';
import type { ShellLog } from '../../core/types';
import { parseAnsi } from '../../core/ansi';
import { Icon } from '../components/icons';
import { t } from '../i18n';

type ShellInfo = { id: string; command: string; running: boolean };

/** Shell 输出页：ANSI 解析只在此页做（parseAnsi 与桌面端 ansi-colors.ts 同源）。 */
export function ShellOutputSheet({ visible, shell, loadLog, subscribeChunks, onStop, onClose }: {
  visible: boolean;
  shell: ShellInfo | null;
  loadLog: (shellId: string) => Promise<ShellLog>;
  subscribeChunks: (listener: (shellId: string, chunk: string) => void) => () => void;
  onStop: (shellId: string) => void;
  onClose: () => void;
}): React.ReactElement | null {
  const [content, setContent] = useState('');
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!visible || !shell) return;
    let alive = true;
    setContent('');
    void loadLog(shell.id).then((log) => {
      if (!alive) return;
      setContent(log.content);
      setTruncated(log.truncated);
    }).catch(() => undefined);
    const off = subscribeChunks((shellId, chunk) => {
      if (shellId !== shell.id) return;
      setContent((current) => `${current}${chunk}`.slice(-200_000));
    });
    return () => { alive = false; off(); };
  }, [visible, shell, loadLog, subscribeChunks]);

  const lines = useMemo(() => content.split('\n'), [content]);
  if (!visible || !shell) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet shell-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <span className="sheet-title">{t('app.shellOutput')}</span>
          <button type="button" className="sheet-close" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="shell-command">{shell.command}</div>
        {truncated && <div className="shell-truncated">仅显示日志尾部</div>}
        <div className="shell-output">
          {lines.map((line, index) => (
            <div key={index} className="shell-line">
              {parseAnsi(line).map((segment, i) => (
                <span key={i} style={{
                  color: segment.color, backgroundColor: segment.background,
                  fontWeight: segment.bold ? 600 : undefined,
                }}>{segment.text || ' '}</span>
              ))}
            </div>
          ))}
          {shell.running && <div className="shell-cursor" />}
        </div>
        {shell.running && (
          <button type="button" className="sheet-action is-danger" onClick={() => onStop(shell.id)}>
            <Icon name="stop" size={15} /> {t('app.stop')}
          </button>
        )}
      </div>
    </div>
  );
}
