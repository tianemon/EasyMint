import type { StoredDevice } from '../../protocol/credential-store';
import { displayDeviceName } from '../../protocol/credential-store';
import type { ConnectionStatus } from '../../core/types';
import { formatLastSeen } from '../../core/session-time';
import { Header } from '../components/Header';
import { Glass } from '../components/Glass';
import { Icon } from '../components/icons';

/** 一级首页：已配对电脑列表（照 App HomeScreen）。 */
export function HomeScreen({ devices, activePcId, connection, pairCode, error,
  onOpenDevice, onAddDevice, onOpenSettings }: {
  devices: StoredDevice[];
  activePcId: string | null;
  connection: ConnectionStatus;
  pairCode: string;
  error: string;
  onOpenDevice: (device: StoredDevice) => void;
  onAddDevice: () => void;
  onOpenSettings: () => void;
}): React.ReactElement {
  // 配对中的六位码：整屏接管，只有提示与码
  if (pairCode) {
    return (
      <div className="screen pair-code-screen">
        <div className="pair-code-hint">请在电脑上核对并确认</div>
        <div className="pair-code-value">{pairCode}</div>
      </div>
    );
  }

  return (
    <div className="screen">
      <Header title="设备" right={
        <button type="button" className="header-pill-hit" onClick={onOpenSettings} aria-label="设置">
          <Glass variant="frosted" radius={13} className="header-pill">
            <span className="header-pill-inner"><Icon name="settings" size={19} /></span>
          </Glass>
        </button>
      } />
      <div className="screen-body home-body">
        {devices.length > 0 ? (
          <Glass variant="frosted" radius={16} className="device-card">
            {devices.map((device, index) => {
              const isActive = device.pcId === activePcId;
              const connected = isActive && connection === 'connected';
              const connecting = isActive && connection === 'connecting';
              const ip = device.addresses.find((address) => /^\d+\./.test(address)) ?? device.addresses[0];
              const tail = connected
                ? ip ?? ''
                : device.lastConnectedAt ? `上次 ${formatLastSeen(device.lastConnectedAt)}` : '';
              return (
                <button key={device.pcId} type="button" className="device-row" onClick={() => onOpenDevice(device)}>
                  {index > 0 && <span className="divider-line" />}
                  <span className="device-main">
                    <span className="device-name">{displayDeviceName(device.pcName)}</span>
                    <span className="device-status-line">
                      <span className={`status-dot${connected ? ' is-on' : connecting ? ' is-pending' : ''}`} />
                      <span className="device-status-text">{connected ? '已连接' : connecting ? '正在连接' : '未连接'}</span>
                      {!!tail && <span className="device-tail">· {tail}</span>}
                    </span>
                  </span>
                  <Icon name="chevron" size={14} />
                </button>
              );
            })}
          </Glass>
        ) : (
          <div className="home-empty">
            <div className="home-empty-title">还没有配对的电脑</div>
            <div className="home-empty-text">在电脑端打开「设备互联」生成二维码，然后用手机扫描。</div>
            <button type="button" className="primary-btn" onClick={onAddDevice}>扫描二维码配对</button>
            {!!error && <div className="home-empty-error">{error}</div>}
          </div>
        )}
      </div>
      {devices.length > 0 && (
        <button type="button" className="fab" onClick={onAddDevice} aria-label="添加设备">
          <Glass variant="liquid" radius={29} className="fab-glass">
            <span className="fab-inner"><Icon name="plus" size={22} /></span>
          </Glass>
        </button>
      )}
    </div>
  );
}
