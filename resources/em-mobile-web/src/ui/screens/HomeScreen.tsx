import type { StoredDevice } from '../../protocol/credential-store';
import { displayDeviceName } from '../../protocol/credential-store';
import type { ConnectionStatus } from '../../core/types';
import { formatLastSeen } from '../../core/session-time';
import { Header } from '../components/Header';
import { Glass } from '../components/Glass';
import { Icon } from '../components/icons';
import { t } from '../i18n';

export function HomeScreen({ devices, activePcId, connection, refreshing, pairCode, error,
  onRefresh, onOpenDevice, onAddDevice, onOpenSettings }: {
  devices: StoredDevice[];
  activePcId: string | null;
  connection: ConnectionStatus;
  refreshing: boolean;
  pairCode: string;
  error: string;
  onRefresh: () => void;
  onOpenDevice: (device: StoredDevice) => void;
  onAddDevice: () => void;
  onOpenSettings: () => void;
}): React.ReactElement {
  const label = connection === 'connected' ? t('app.connected') : connection === 'connecting' ? t('app.connecting') : t('app.disconnected');
  return (
    <div className="screen">
      <Header title="EasyMint" rightLabel={t('app.settings')} onRight={onOpenSettings} />
      <div className="screen-body home-body">
        <div className="section-label">{t('app.devices')}</div>
        {devices.length === 0 && <div className="empty-hint">{t('app.noDevices')}</div>}
        {devices.map((device) => {
          const active = device.pcId === activePcId;
          return (
            <Glass key={device.pcId} className="device-row" >
              <button type="button" className="device-hit" onClick={() => onOpenDevice(device)}>
                <span className={`device-dot${active && connection === 'connected' ? ' is-on' : ''}${active && connection === 'connecting' ? ' is-pending' : ''}`} />
                <span className="device-info">
                  <span className="device-name">{displayDeviceName(device.pcName)}</span>
                  <span className="device-sub">{active ? label : (device.lastConnectedAt ? formatLastSeen(device.lastConnectedAt) : t('app.disconnected'))}</span>
                </span>
                {active && <span className="device-active-tag">当前</span>}
                <Icon name="chevron" size={15} />
              </button>
            </Glass>
          );
        })}
        <button type="button" className="home-add" onClick={onAddDevice}>
          <Icon name="plus" size={16} /> {t('app.addDevice')}
        </button>
        <button type="button" className="home-refresh" onClick={onRefresh} disabled={refreshing}>
          <Icon name="refresh" size={14} /> {refreshing ? '刷新中…' : '重试连接 / 刷新'}
        </button>

        {pairCode && (
          <Glass className="pair-code-card">
            <div className="pair-code-title">{t('app.pairCodeTitle')}</div>
            <div className="pair-code-value">{pairCode}</div>
            <div className="pair-code-hint">{t('app.pairWaiting')}</div>
            <div className="pair-code-hint">{t('app.pairCodeHint')}</div>
          </Glass>
        )}
        {error && <div className="error-banner"><Icon name="alert" size={14} /> {error}</div>}
      </div>
    </div>
  );
}
