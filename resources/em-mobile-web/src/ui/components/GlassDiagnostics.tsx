import { useEffect, useRef, useState } from 'react';

type Mode = 'layered' | 'full' | 'no-dispersion' | 'edge' | 'frost' | 'off';
type Sample = { ms: number; rows: number; mirrored: number };
const options: Array<[Mode, string]> = [['full', '完整液态'], ['layered', '分层完整液态'], ['no-dispersion', '关闭色散'], ['edge', '边缘折射'], ['frost', '仅磨砂'], ['off', '关闭玻璃']];
const empty = () => ({ fps: 0, low: 0, stalls: 0, avg: 0, max: 0, rows: 0, mirrored: 0, frames: 0, updates: 0 });

/** Temporary local-only comparison tool; does not collect message contents. */
export function GlassDiagnostics(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('full');
  const [result, setResult] = useState(empty);
  const [copied, setCopied] = useState('');
  const frames = useRef<number[]>([]);
  const times = useRef<number[]>([]);
  const counts = useRef({ stalls: 0, rows: 0, mirrored: 0, frames: 0, updates: 0 });
  const reset = (): void => { frames.current = []; times.current = []; counts.current = { stalls: 0, rows: 0, mirrored: 0, frames: 0, updates: 0 }; setResult(empty()); setCopied(''); };
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.app'); if (!root) return;
    root.dataset.glassDiagnosticMode = mode;
    root.dispatchEvent(new Event('liquid-diagnostic-mode'));
    reset();
    return () => { delete root.dataset.glassDiagnosticMode; root.dispatchEvent(new Event('liquid-diagnostic-mode')); };
  }, [mode]);
  useEffect(() => {
    if (!open) return;
    const root = document.querySelector<HTMLElement>('.app'); if (!root) return;
    root.dataset.glassDiagnosticActive = 'true';
    let id = 0, last = 0, shown = 0;
    const sample = (event: Event): void => {
      const detail = (event as CustomEvent<Sample>).detail;
      if (!detail || !Number.isFinite(detail.ms)) return;
      times.current.push(detail.ms); if (times.current.length > 600) times.current.shift();
      counts.current.updates++; counts.current.rows = detail.rows; counts.current.mirrored = detail.mirrored;
    };
    const tick = (now: number): void => {
      if (!document.hidden && last) {
        const elapsed = now - last;
        if (elapsed < 1000) { frames.current.push(elapsed); if (frames.current.length > 600) frames.current.shift(); counts.current.frames++; if (elapsed > 50) counts.current.stalls++; }
      }
      last = document.hidden ? 0 : now;
      if (now - shown >= 1000) {
        shown = now; counts.current.rows = root.querySelectorAll('.message-column > [data-liquid-row]').length;
        if (root.dataset.glassDiagnosticMode === 'off') counts.current.mirrored = 0;
        const sorted = [...frames.current].sort((a, b) => a - b); const durations = times.current;
        const total = sorted.reduce((sum, value) => sum + value, 0);
        setResult({ ...counts.current, fps: total ? 1000 * sorted.length / total : 0,
          low: sorted.length ? 1000 / sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .99))] : 0,
          avg: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0,
          max: durations.length ? Math.max(...durations) : 0 });
      }
      id = requestAnimationFrame(tick);
    };
    root.addEventListener('liquid-diagnostic-sample', sample); id = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(id); root.removeEventListener('liquid-diagnostic-sample', sample); delete root.dataset.glassDiagnosticActive; };
  }, [open]);
  const report = `液态玻璃性能诊断\n模式：${options.find(([value]) => value === mode)?.[1]}\n平均帧率：${result.fps.toFixed(1)} FPS\n较低帧率（1%）：${result.low.toFixed(1)} FPS\n超过 50ms 的帧：${result.stalls}\n镜像更新平均／最高：${result.avg.toFixed(2)} / ${result.max.toFixed(2)} ms\n消息行／镜像行：${result.rows} / ${result.mirrored}\n样本帧／镜像更新：${result.frames} / ${result.updates}`;
  const copy = async (): Promise<void> => {
    try { if (!navigator.clipboard?.writeText) throw new Error('unavailable'); await navigator.clipboard.writeText(report); setCopied('已复制'); }
    catch { setCopied('当前浏览器不能自动复制，请长按下方结果复制。'); }
  };
  return <aside className="glass-diagnostics" data-glass-diagnostics="" aria-label="玻璃性能诊断">
    <button className="glass-diagnostics-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? '收起诊断' : '性能诊断'}</button>
    {open && <div className="glass-diagnostics-panel">
      <div className="glass-diagnostics-modes">{options.map(([value, label]) => <button key={value} onClick={() => setMode(value)} aria-pressed={mode === value}>{label}</button>)}</div>
      <div>平均 {result.fps.toFixed(1)} FPS · 较低 {result.low.toFixed(1)} FPS · 卡顿 {result.stalls} 次</div>
      <div>镜像更新 {result.avg.toFixed(2)} / {result.max.toFixed(2)} ms（平均 / 最高）</div>
      <div>消息行 {result.rows} · 镜像行 {result.mirrored} · 更新 {result.updates} 次</div>
      <small>卡顿：单帧超过 50ms；较低帧率为最慢 1% 的近似值。GPU 耗时需通过模式对比。</small>
      <div className="glass-diagnostics-actions"><button onClick={reset}>重置</button><button onClick={() => void copy()}>复制结果</button><span>{copied}</span></div>
      {copied && copied !== '已复制' && <textarea readOnly value={report} aria-label="诊断结果" onFocus={event => event.currentTarget.select()} />}
    </div>}
  </aside>;
}
