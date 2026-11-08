import { ModelGlyph, ToolIcon } from './icons';

/** 状态行：图标 + 当前动作文案；有工具在跑用该工具图标，否则用动效模型图标（照 App MintStatus）。 */
export function MintStatus({ text, icon }: {
  text: string;
  icon?: string;
}): React.ReactElement | null {
  if (!text) return null;
  return (
    <div className="mint-status" role="status">
      <span className="mint-status-icon">
        {icon ? <ToolIcon name={icon} size={14} /> : <ModelGlyph size={14} animated />}
      </span>
      <span className="mint-status-text">{text}</span>
    </div>
  );
}
