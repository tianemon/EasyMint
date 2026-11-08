/**
 * 未配对 / 连接失效时的兜底入口：手动输入 10 位配对码。
 *
 * 主路径是页面上的「开始配对」——它会向电脑端现场要一份配对材料，不需要任何码。
 * 这里保留手输，用于「页面能打开但拿不到材料」的极端情况（例如静态页被缓存在别处）：
 * 电脑端面板上有明文码，输入即可。
 *
 * 这里**不做拍照扫码**：局域网 http 是非安全上下文，`getUserMedia` / `BarcodeDetector`
 * 都不可用；而 `<input capture>` + 本地解码虽然能跑，但既然页面自己能要到配对材料，
 * 多一条拍照路径只会增加失败面（识别失败、照片方向、模糊）。
 */
import { useState } from 'react';
import { extractPairCode } from '../../protocol/pairing';
import { Icon } from './icons';

export function PairRecovery({ onSubmitCode }: { onSubmitCode: (code: string) => void }): React.ReactElement {
  const [mode, setMode] = useState<'idle' | 'manual'>('idle');
  const [value, setValue] = useState('');
  const [hint, setHint] = useState('');

  const submit = (): void => {
    const code = extractPairCode(value);
    if (!code) { setHint('没有识别到有效的配对码，请重新输入'); return; }
    setHint('');
    onSubmitCode(code);
  };

  if (mode === 'idle') {
    return (
      <div className="pair-recovery">
        <button type="button" className="pair-recovery-btn" onClick={() => setMode('manual')}>
          手动输入配对码
        </button>
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
