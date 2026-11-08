import { useEffect, useState } from 'react';
import { Glass } from '../components/Glass';
import { Icon } from '../components/icons';
import { PairRecovery } from '../components/PairRecovery';
import { t } from '../i18n';
import {
  isFullscreenSupported, isFullscreenActive, toggleFullscreen, subscribeFullscreen,
} from '../fullscreen';
import {
  canPromptInstall, promptInstall, platformHint, subscribeInstallAvailability,
} from '../install';

/** 配对引导页（原扫码页）：页面不做相机，扫码交给系统相机；未配对时不显示任何项目/会话信息。 */
export function PairGuideScreen({ pairCode, error, onCancel, onRetry, retrying, onSubmitCode }: {
  pairCode: string;
  error: string;
  onCancel?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  onSubmitCode?: (code: string) => void;
}): React.ReactElement {
  const pairing = Boolean(pairCode);
  const fsSupported = isFullscreenSupported();
  const [fsActive, setFsActive] = useState(isFullscreenActive);
  const [canInstall, setCanInstall] = useState(canPromptInstall);
  useEffect(() => subscribeFullscreen(() => setFsActive(isFullscreenActive())), []);
  useEffect(() => subscribeInstallAvailability(() => setCanInstall(canPromptInstall())), []);
  const hint = platformHint();
  return (
    <div className="screen pair-guide">
      <div className="pair-guide-inner">
        <div className="pair-guide-mark"><Icon name="plusChat" size={38} /></div>
        <h1 className="pair-guide-title">{pairing ? t('app.pairCodeTitle') : t('app.pairGuideTitle')}</h1>
        {pairing ? (
          <Glass className="pair-code-card">
            <div className="pair-code-value">{pairCode}</div>
            <div className="pair-code-hint">{t('app.pairWaiting')}</div>
            <div className="pair-code-hint">{t('app.pairCodeHint')}</div>
          </Glass>
        ) : (
          <p className="pair-guide-body">{t('app.pairGuideBody')}</p>
        )}
        {error && <div className="error-banner"><Icon name="alert" size={14} /> {error}</div>}
        {onRetry && (
          <button type="button" className="pair-retry" onClick={onRetry} disabled={retrying}>
            <Icon name="refresh" size={14} /> {retrying ? '正在重试…' : '重试连接'}
          </button>
        )}
        <div className="pair-guide-steps">
          <div><span>1</span> 在电脑端 EasyMint「设置」里开启手机访问</div>
          <div><span>2</span> 用手机相机扫描生成的二维码</div>
          <div><span>3</span> 核对 6 位验证码并在电脑上确认</div>
        </div>
        {/* 主屏独立打开、或凭证丢失时走这里：系统相机扫码会把页面拉回 Safari，
            所以必须有一条留在本页内的恢复路径 */}
        {onSubmitCode && !pairing && <PairRecovery onSubmitCode={onSubmitCode} />}
        {fsSupported && (
          <button type="button" className="pair-guide-fullscreen" onClick={() => { void toggleFullscreen(); }}>
            {fsActive ? '退出全屏' : '全屏显示'}
          </button>
        )}
        {canInstall
          ? <button type="button" className="pair-guide-fullscreen" onClick={() => { void promptInstall(); }}>安装到桌面</button>
          : hint && <p className="pair-guide-install-hint">{hint}</p>}
        {onCancel && <button type="button" className="pair-guide-back" onClick={onCancel}>{t('app.back')}</button>}
      </div>
    </div>
  );
}
