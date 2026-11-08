import { useEffect, useRef, useState } from 'react';
import type { ShellLog } from '../../core/types';
import { parseAnsi } from '../../core/ansi';
import { AmbientBackground } from '../components/AmbientBackground';
import { Header } from '../components/Header';
import { ChevronIcon, SpinIcon, iconSize } from '../components/icons';

type ShellInfo = { id: string; command: string; running: boolean };

/** 渲染上限：日志可达 100KB，只渲染尾部，避免一次铺太多着色段拖慢布局。 */
const MAX_VIEW_CHARS = 30_000;
const AT_BOTTOM_PX = 24;

/**
 * 后台命令输出查看页 —— 对应 App ShellOutputSheet（整屏 pageSheet）：
 * 打开先加载日志尾部，运行中订阅实时输出；等宽 + ANSI 着色；自动贴底跟随，滚离底部出回底按钮。
 */
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
  const [loading, setLoading] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const followTail = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shellId = shell?.id ?? null;

  useEffect(() => {
    if (!visible || !shellId) return;
    let alive = true;
    followTail.current = true;
    setAwayFromBottom(false);
    setContent('');
    setTruncated(false);
    setLoading(true);
    void loadLog(shellId).then((log) => {
      if (!alive) return;
      // 拼在已到的实时块前面：readLog 是网络往返，期间到的块更新
      setContent((current) => log.content + current);
      setTruncated(log.truncated);
    }).catch(() => undefined).finally(() => { if (alive) setLoading(false); });
    const off = subscribeChunks((id, chunk) => {
      if (id !== shellId) return;
      setContent((current) => current + chunk);
    });
    return () => { alive = false; off(); };
    // loadLog / subscribeChunks 由 App 提供，标识稳定；只在打开或切换命令时重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, shellId]);

  const visibleText = content.length > MAX_VIEW_CHARS ? content.slice(-MAX_VIEW_CHARS) : content;
  const clipped = content.length > MAX_VIEW_CHARS;
  const running = !!shell?.running;

  useEffect(() => {
    if (!visible || !followTail.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleText, visible]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < AT_BOTTOM_PX;
    followTail.current = bottom;
    setAwayFromBottom(!bottom);
  };

  const scrollToBottom = (): void => {
    followTail.current = true;
    setAwayFromBottom(false);
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  if (!visible || !shell) return null;
  return (
    <div className="shell-page">
      <AmbientBackground />
      <div className="shell-page-content">
        <Header title={shell.command} onBack={onClose} right={running
          ? <button type="button" className="shell-stop" onClick={() => onStop(shell.id)}>停止</button>
          : undefined} />
        <div className="shell-status-row">
          {running && <SpinIcon size={iconSize.card} className="shell-status-spin" />}
          <span className="shell-status-text">{running ? '运行中' : '已结束'}</span>
        </div>
        {(truncated || clipped) && <div className="shell-truncated">日志较大，仅显示最近输出</div>}
        <div className="shell-output" ref={scrollRef} onScroll={onScroll}>
          {loading
            ? <div className="shell-placeholder">读取输出…</div>
            : visibleText
              ? (
                <div className="shell-output-text">
                  {visibleText.split('\n').map((line, index) => (
                    <div key={index} className="shell-line">
                      {parseAnsi(line).map((segment, i) => (
                        <span key={i} style={{
                          color: segment.color, backgroundColor: segment.background,
                          fontWeight: segment.bold ? 600 : undefined,
                        }}>{segment.text || ' '}</span>
                      ))}
                    </div>
                  ))}
                </div>
              )
              : <div className="shell-placeholder">{running ? '等待输出…' : '(无输出)'}</div>}
        </div>
      </div>
      {awayFromBottom && (
        <button type="button" className="shell-to-bottom" aria-label="回到底部" onClick={scrollToBottom}>
          <ChevronIcon size={iconSize.nav} direction="down" />
        </button>
      )}
    </div>
  );
}
