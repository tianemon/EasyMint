import { Glass } from '../components/Glass';
import { Icon } from '../components/icons';
import { t } from '../i18n';

/** 配对引导页（原扫码页）：页面不做相机，扫码交给系统相机；未配对时不显示任何项目/会话信息。 */
export function PairGuideScreen({ pairCode, error, onCancel, onRetry, retrying }: {
  pairCode: string;
  error: string;
  onCancel?: () => void;
  onRetry?: () => void;
  retrying?: boolean;
}): React.ReactElement {
  const pairing = Boolean(pairCode);
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
        {onCancel && <button type="button" className="pair-guide-back" onClick={onCancel}>{t('app.back')}</button>}
      </div>
    </div>
  );
}
