import { useEffect, useState } from 'react';
import { Icon, toolIconName } from './icons';

/** 状态行：与提问卡一起置于滚动区尾部。文案由 useRemoteEvents 写入，带按会话去重。 */
export function MintStatus({ text, icon, running }: {
  text: string;
  icon?: string;
  running: boolean;
}): React.ReactElement | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!text) return null;
  return (
    <div className="mint-status" role="status">
      <span className={`mint-status-dot${running ? ' is-running' : ''}`} />
      <Icon name={icon ? toolIconName(icon) : 'bot'} size={14} />
      <span className="mint-status-text">{text}</span>
    </div>
  );
}
