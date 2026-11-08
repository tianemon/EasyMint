/**
 * 未配对 / 连接失效时的恢复入口。
 *
 * 两条路：
 *  1. 手动输入——电脑端二维码下面那串 10 位短码，或整条配对链接直接粘进来；
 *  2. 相机扫码——只在安全上下文（https / localhost）里可用。局域网 http 下
 *     `navigator.mediaDevices` 根本不存在，此时不渲染按钮，改成一句说明，
 *     免得用户点了没反应还以为坏了。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { extractPairCode } from '../../protocol/pairing';
import { Icon } from './icons';

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function cameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}

export function PairRecovery({ onSubmitCode }: { onSubmitCode: (code: string) => void }): React.ReactElement {
  const [mode, setMode] = useState<'idle' | 'manual' | 'camera'>('idle');
  const [value, setValue] = useState('');
  const [scanError, setScanError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canScan = cameraAvailable();

  const stopCamera = useCallback((): void => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // 相机：能拿到 BarcodeDetector 才真的扫；否则明确告知不支持，不假装在工作
  useEffect(() => {
    if (mode !== 'camera') return;
    const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) { setScanError('这个浏览器不支持网页内扫码，请用系统相机扫描电脑上的二维码'); return; }
    let stopped = false;
    let timer = 0;
    const detector = new Detector({ formats: ['qr_code'] });
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async (): Promise<void> => {
          if (stopped || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            const code = found.length ? extractPairCode(found[0].rawValue) : null;
            if (code) { stopCamera(); onSubmitCode(code); return; }
          } catch { /* 单帧识别失败继续下一帧 */ }
          timer = window.setTimeout(() => { void tick(); }, 350);
        };
        void tick();
      } catch (e) {
        setScanError(e instanceof Error && e.name === 'NotAllowedError'
          ? '没有相机权限，请在浏览器设置里允许后重试'
          : '打不开相机，请改用系统相机扫码');
      }
    })();
    return () => { stopped = true; window.clearTimeout(timer); stopCamera(); };
  }, [mode, onSubmitCode, stopCamera]);

  const submit = (): void => {
    const code = extractPairCode(value);
    if (!code) { setScanError('没识别到有效的配对码，请重新复制'); return; }
    setScanError('');
    onSubmitCode(code);
  };

  if (mode === 'idle') {
    return (
      <div className="pair-recovery">
        <button type="button" className="pair-recovery-link" onClick={() => setMode('manual')}>手动输入配对码</button>
        {canScan && (
          <>
            <span className="pair-recovery-dot">·</span>
            <button type="button" className="pair-recovery-link" onClick={() => setMode('camera')}>相机扫码</button>
          </>
        )}
      </div>
    );
  }

  if (mode === 'camera') {
    return (
      <div className="pair-recovery-panel">
        <video ref={videoRef} className="pair-scan-video" muted playsInline />
        {scanError
          ? <div className="pair-recovery-hint">{scanError}</div>
          : <div className="pair-recovery-hint">把电脑上的二维码放进取景框</div>}
        <button type="button" className="pair-recovery-cancel"
          onClick={() => { stopCamera(); setScanError(''); setMode('idle'); }}>取消</button>
      </div>
    );
  }

  return (
    <div className="pair-recovery-panel">
      <input className="pair-recovery-input" value={value} inputMode="text" autoComplete="off"
        placeholder="粘贴配对链接，或输入 10 位配对码"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} />
      {scanError && <div className="pair-recovery-hint">{scanError}</div>}
      <div className="pair-recovery-actions">
        <button type="button" className="pair-recovery-cancel"
          onClick={() => { setScanError(''); setMode('idle'); }}>取消</button>
        <button type="button" className="pair-recovery-submit" onClick={submit}>
          <Icon name="check" size={13} /> 连接
        </button>
      </div>
    </div>
  );
}
