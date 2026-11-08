import { useEffect, useState } from 'react';
import { Glass } from '../components/Glass';
import { Icon } from '../components/icons';
import { PairRecovery } from '../components/PairRecovery';
import { t } from '../i18n';
import {
  canPromptInstall, promptInstall, subscribeInstallAvailability,
} from '../install';

/** 是否已从主屏幕启动（standalone）：此时不必再提示「添加到主屏幕」。 */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/**
 * 未配对页。
 *
 * 两条分支：
 *  - 配对进行中（pairCode 非空）：显示 6 位验证码，等电脑端确认；
 *  - 未开始：安装引导 + 「开始配对」。
 *
 * 「开始配对」**不依赖 URL 里的短码**：点按钮时向电脑端现场要一份配对材料
 * （`/pair/new.json`）。iOS 从主屏启动会丢掉 `#p=`（manifest 的 start_url 也会覆盖启动地址），
 * 所以扫码只负责「打开页面 + 添加到主屏幕」，配对由这个按钮触发。
 */
export function PairGuideScreen({ pairCode, error, onCancel, onRetry, retrying, onSubmitCode, onStartPair }: {
  pairCode: string;
  error: string;
  onCancel?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
  onSubmitCode?: (code: string) => void;
  onStartPair?: () => void;
}): React.ReactElement {
  const pairing = Boolean(pairCode);
  const standalone = isStandalone();
  const [canInstall, setCanInstall] = useState(canPromptInstall);
  useEffect(() => subscribeInstallAvailability(() => setCanInstall(canPromptInstall())), []);

  return (
    <div className="screen pair-guide">
      <div className="pair-guide-inner">
        <div className="pair-guide-mark"><Icon name="plusChat" size={38} /></div>
        <h1 className="pair-guide-title">
          {pairing ? t('app.pairCodeTitle') : standalone ? t('app.pairStartTitle') : t('app.installTitle')}
        </h1>

        {pairing ? (
          <Glass className="pair-code-card">
            <div className="pair-code-value">{pairCode}</div>
            <div className="pair-code-hint">{t('app.pairWaiting')}</div>
            <div className="pair-code-hint">{t('app.pairCodeHint')}</div>
          </Glass>
        ) : (
          <>
            <p className="pair-guide-body">
              {standalone ? t('app.pairStartBody') : t('app.installBody')}
            </p>
            {!standalone && (
              <div className="pair-guide-steps install-steps">
                <div>{t('app.installGeneric')}</div>
                <div>{t('app.installChrome')}</div>
                <div>{t('app.installSafari')}</div>
              </div>
            )}
            {!standalone && canInstall && (
              <button type="button" className="pair-install-btn" onClick={() => { void promptInstall(); }}>
                {t('app.installPrimary')}
              </button>
            )}
            <button type="button" className="pair-start-btn" onClick={onStartPair} disabled={!onStartPair}>
              {t('app.startPairing')}
            </button>
          </>
        )}

        {error && <div className="error-banner"><Icon name="alert" size={14} /> {error}</div>}
        {onRetry && (
          <button type="button" className="pair-retry" onClick={onRetry} disabled={retrying}>
            <Icon name="refresh" size={14} /> {retrying ? '正在重试…' : '重试连接'}
          </button>
        )}
        {/* 手动输入是兜底：电脑端面板上有 10 位明文配对码 */}
        {!pairing && onSubmitCode && <PairRecovery onSubmitCode={onSubmitCode} />}
        {onCancel && <button type="button" className="pair-guide-back" onClick={onCancel}>{t('app.back')}</button>}
      </div>
    </div>
  );
}
