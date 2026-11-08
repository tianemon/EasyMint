import { Icon, toolIconName } from './icons';

/** 状态行：位于滚动区尾部。有工具在跑显示工具图标，其余显示动效模型图标（照 App MintStatus）。 */
export function MintStatus({ text, icon }: {
  text: string;
  icon?: string;
}): React.ReactElement | null {
  if (!text) return null;
  return (
    <div className="mint-status" role="status">
      {icon
        ? <Icon name={toolIconName(icon)} size={14} className="mint-status-icon" />
        : <Icon name="bot" size={14} className="mint-status-icon is-model" />}
      <span className="mint-status-text">{text}</span>
    </div>
  );
}
