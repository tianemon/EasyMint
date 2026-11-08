/**
 * 未配对 / 连接失效时的恢复入口。
 *
 * 两条路：
 *  1. 拍照扫码——`<input type="file" accept="image/*" capture="environment">` 调系统相机拍一张，
 *     在页面内用纯 JS 解码。**这条路不依赖安全上下文**：局域网 http 下 `getUserMedia` 与
 *     `BarcodeDetector` 都不存在（之前就是这么写的，iPhone 上必然不可用），而拍照 + 本地解码
 *     只需要 `<input>` 与 canvas。
 *  2. 手动输入——电脑端二维码下面那串 10 位配对码（带不带 5-5 的分组横杠都认），或整条链接。
 *
 * 为什么不用实时取景：局域网 http 拿不到相机流；而且拍照一帧就够解一个静态二维码。
 */
import { useRef, useState } from 'react';
import jsQR from 'jsqr';
import { extractPairCode } from '../../protocol/pairing';
import { Icon } from './icons';

/** 解码前把照片缩到这个边长内：手机原图 4000px 直接解会卡住主线程好几秒。 */
const MAX_SIDE = 1280;

async function decodeImageFile(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const { data } = context.getImageData(0, 0, width, height);
  // dontInvert：深色背景的码很少见，跳过反色尝试省一半时间
  const found = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
  return found ? found.data : null;
}

export function PairRecovery({ onSubmitCode }: { onSubmitCode: (code: string) => void }): React.ReactElement {
  const [mode, setMode] = useState<'idle' | 'manual'>('idle');
  const [value, setValue] = useState('');
  const [hint, setHint] = useState('');
  const [decoding, setDecoding] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setDecoding(true);
    setHint('');
    try {
      const raw = await decodeImageFile(file);
      const code = raw ? extractPairCode(raw) : null;
      if (!code) {
        setHint('这张照片里没识别到配对二维码，对着电脑屏幕再拍一次试试');
        return;
      }
      onSubmitCode(code);
    } catch {
      setHint('照片读取失败，请重拍或改用手动输入');
    } finally {
      setDecoding(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const submit = (): void => {
    const code = extractPairCode(value);
    if (!code) { setHint('没识别到有效的配对码，请重新输入'); return; }
    setHint('');
    onSubmitCode(code);
  };

  if (mode === 'idle') {
    return (
      <div className="pair-recovery">
        <button type="button" className="pair-recovery-link" onClick={() => fileInput.current?.click()}>
          {decoding ? '正在识别…' : '拍照扫码'}
        </button>
        <span className="pair-recovery-dot">·</span>
        <button type="button" className="pair-recovery-link" onClick={() => setMode('manual')}>手动输入配对码</button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="pair-scan-file"
          onChange={(event) => { void handleFile(event.target.files?.[0]); }}
        />
        {hint && <div className="pair-recovery-hint">{hint}</div>}
      </div>
    );
  }

  return (
    <div className="pair-recovery-panel">
      <input
        className="pair-recovery-input"
        value={value}
        inputMode="text"
        autoComplete="off"
        placeholder="输入 10 位配对码（如 ABCDE-FGHIJ）"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
      />
      {hint && <div className="pair-recovery-hint">{hint}</div>}
      <div className="pair-recovery-actions">
        <button type="button" className="pair-recovery-cancel"
          onClick={() => { setHint(''); setMode('idle'); }}>取消</button>
        <button type="button" className="pair-recovery-submit" onClick={submit}>
          <Icon name="check" size={13} /> 连接
        </button>
      </div>
    </div>
  );
}
