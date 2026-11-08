import type { StoredDevice } from '../../protocol/credential-store';
import { displayDeviceName } from '../../protocol/credential-store';
import type { ConnectionStatus } from '../../core/types';
import type { ThemeMode } from '../theme';
import type { BackgroundPreset } from '../components/BackgroundPills';
import { Header } from '../components/Header';
import { Glass } from '../components/Glass';
import { AppearanceSlider } from '../components/AppearanceSlider';
import { BackgroundPills } from '../components/BackgroundPills';
import { Icon } from '../components/icons';
import { t } from '../i18n';

export function SettingsScreen({ device, connection, themeMode, background, onThemeMode, onBackground,
  onBack, onRepair, onForget }: {
  device: StoredDevice | null;
  connection: ConnectionStatus;
  themeMode: ThemeMode;
  background: BackgroundPreset;
  onThemeMode: (mode: ThemeMode) => void;
  onBackground: (preset: BackgroundPreset) => void;
  onBack: () => void;
  onRepair: () => void;
  onForget: () => void;
}): React.ReactElement {
  const label = connection === 'connected' ? t('app.connected') : connection === 'connecting' ? t('app.connecting') : t('app.disconnected');
  return (
    <div className="screen">
      <Header title={t('app.settings')} onBack={onBack} />
      <div className="screen-body settings-body">
        <div className="section-label">{t('app.appearance')}</div>
        <Glass className="settings-group">
          <div className="settings-row"><span>主题</span><AppearanceSlider value={themeMode} onChange={onThemeMode} /></div>
          <div className="settings-row"><span>环境背景</span><BackgroundPills value={background} onChange={onBackground} /></div>
        </Glass>

        <div className="section-label">已配对的电脑</div>
        <Glass className="settings-group">
          <div className="settings-row">
            <span>设备</span><span className="settings-value">{device ? displayDeviceName(device.pcName) : '—'}</span>
          </div>
          <div className="settings-row">
            <span>连接</span><span className="settings-value"><span className={`device-dot${connection === 'connected' ? ' is-on' : ''}`} /> {label}</span>
          </div>
          <div className="settings-row">
            <span>服务端口</span><span className="settings-value">{device?.port ?? 47778}</span>
          </div>
        </Glass>
        <div className="settings-note">会话与项目数据只保存在电脑端，本页面不写入任何业务数据。</div>

        <button type="button" className="settings-action" onClick={onRepair}>
          <Icon name="refresh" size={15} /> 重新扫码配对
        </button>
        {device && (
          <button type="button" className="settings-action is-danger" onClick={onForget}>
            <Icon name="trash" size={15} /> {t('app.forget')}
          </button>
        )}
      </div>
    </div>
  );
}
