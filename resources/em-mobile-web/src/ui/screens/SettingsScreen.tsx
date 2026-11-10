import type { StoredDevice } from '../../protocol/credential-store';
import { displayDeviceName } from '../../protocol/credential-store';
import type { ConnectionStatus } from '../../core/types';
import type { ThemeMode } from '../theme';
import { Header } from '../components/Header';
import { Glass } from '../components/Glass';
import { AppearanceSlider } from '../components/AppearanceSlider';
import { t } from '../i18n';
import { useState } from 'react';
import { measureConnection } from '../../core/connection-diagnostic';
import type { FrameResult } from '../../core/connection-diagnostic';

/**
 * 设置页（照 App SettingsScreen）：三组「外观 / 电脑 / 关于」，没有环境背景、服务端口、提示文案。
 * 操作按钮直接压在「电脑」卡片里，不再各自包大按钮。
 */
export function SettingsScreen({ device, connection, connectionAddress, themeMode, onThemeMode, onDiagnose,
  frameRunning, frameResult, previousFrameResult, computerResources, onFrameDiagnostic,
  onBack, onRepair, onForget }: {
  device: StoredDevice | null;
  connection: ConnectionStatus;
  connectionAddress: string | null;
  themeMode: ThemeMode;
  onThemeMode: (mode: ThemeMode) => void;
  onDiagnose: () => Promise<unknown>;
  frameRunning: boolean;
  frameResult: FrameResult | null;
  previousFrameResult: FrameResult | null;
  computerResources: { cpuPercent: number | null; memoryPercent: number } | null;
  onFrameDiagnostic: () => void;
  onBack: () => void;
  onRepair: () => void;
  onForget: () => void;
}): React.ReactElement {
  const status = connection === 'connected' ? '已连接' : connection === 'connecting' ? '正在连接' : '未连接';
  const dot = connection === 'connected' ? ' is-on' : connection === 'connecting' ? ' is-pending' : '';
  const ip = connection === 'connected' ? connectionAddress : null;
  const [diagnosing, setDiagnosing] = useState(false);
  const [measurements, setMeasurements] = useState<number[][]>([]);
  const [diagnosticError, setDiagnosticError] = useState('');
  const diagnose = async (): Promise<void> => {
    setDiagnosing(true); setDiagnosticError('');
    try { const result = await measureConnection(onDiagnose); setMeasurements(previous => [...previous, result].slice(-2)); }
    catch { setDiagnosticError('检测未完成，请检查连接后重试。'); }
    finally { setDiagnosing(false); }
  };
  return (
    <div className="screen">
      <Header title={t('app.settings')} onBack={onBack} />
      <div className="screen-body settings-body">
        <div className="settings-group-label">外观</div>
        <AppearanceSlider value={themeMode} onChange={onThemeMode} />

        <div className="settings-group-label">电脑</div>
        <Glass variant="frosted" blur radius={16} className="settings-card">
          {device ? (
            <>
              <div className="settings-info-row">
                <div className="settings-device-main">
                  <div className="settings-device-name">{displayDeviceName(device.pcName)}</div>
                  <div className="settings-status-line">
                    <span className={`status-dot${dot}`} />
                    <span className="settings-status-text">{status}</span>
                    {!!ip && <span className="settings-ip">· {ip}</span>}
                  </div>
                  {connection === 'disconnected' && <div className="settings-status-text">请检查电脑连接；若配对已撤销，可重新配对。</div>}
                </div>
              </div>
              <div className="settings-divider" />
              <div className="settings-actions">
                <button type="button" className="settings-action-btn" onClick={onRepair}>重新配对</button>
                <span className="settings-action-divider" />
                <button type="button" className="settings-action-btn is-danger" onClick={onForget}>移除此电脑</button>
              </div>
            </>
          ) : (
            <div className="settings-info-row"><span className="settings-empty">还没有配对的电脑</span></div>
          )}
        </Glass>

        {device && <>
          <div className="settings-group-label">连接检测</div>
          <Glass variant="frosted" blur radius={16} className="settings-card">
            <div className="settings-row"><span>检测电脑响应</span>
              <button type="button" className="settings-action-btn" disabled={diagnosing || connection !== 'connected'} onClick={() => void diagnose()}>
                {diagnosing ? '检测中…' : '开始检测'}
              </button>
            </div>
            {measurements.map((sample, index) => <div key={index} className="settings-row">
              <span>{measurements.length === 2 && index === 0 ? '上一次' : '本次'}（网络与电脑处理）</span>
              <span>{sample.join(' / ')} ms</span>
            </div>)}
            {diagnosticError && <div className="settings-row">{diagnosticError}</div>}
            <div className="settings-row"><span>聊天流畅度</span>
              <button type="button" className="settings-action-btn" disabled={frameRunning || connection !== 'connected'} onClick={onFrameDiagnostic}>
                {frameRunning ? '记录中…' : '开始记录'}
              </button>
            </div>
            {frameRunning && <div className="settings-row">请在 20 秒内打开聊天并滑动，再返回查看。</div>}
            {previousFrameResult && <div className="settings-row">{previousFrameResult.seconds > 0
              ? `上次：${previousFrameResult.seconds.toFixed(1)} 秒 · ${Math.round(previousFrameResult.frames / previousFrameResult.seconds)} FPS · 卡顿 ${previousFrameResult.slowFrames} 次`
              : '上次未采集到聊天画面。'}</div>}
            {frameResult && <div className="settings-row">{frameResult.seconds > 0
              ? `本次：${frameResult.seconds.toFixed(1)} 秒 · ${Math.round(frameResult.frames / frameResult.seconds)} FPS · 超过 50ms ${frameResult.slowFrames} 次`
              : '未采集到聊天画面，请重新记录。'}</div>}
            {computerResources && <div className="settings-row">电脑 CPU {computerResources.cpuPercent ?? '—'}% · 内存 {computerResources.memoryPercent}%（开始时）</div>}
            {frameResult && !computerResources && <div className="settings-row">电脑资源数据暂不可用。</div>}
          </Glass>
        </>}

        <div className="settings-group-label">关于</div>
        <Glass variant="frosted" blur radius={16} className="settings-card">
          <div className="settings-row">
            <span>版本</span>
            <span className="settings-version">{__EM_VERSION__}</span>
          </div>
        </Glass>
      </div>
    </div>
  );
}
