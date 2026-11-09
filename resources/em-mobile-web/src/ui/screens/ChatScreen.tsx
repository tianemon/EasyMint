import { useEffect, useMemo, useRef, useState } from 'react';
import type { AskAnswer } from '../../core/types';
import type { BackgroundAgent, BackgroundShell, PendingAsk } from '../../protocol/types';
import type { DisplayMessage } from '../../core/messages';
import type { ConnectionStatus } from '../../core/types';
import { Header } from '../components/Header';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import type { ComposerProps } from '../components/Composer';
import { AskCard } from '../components/AskCard';
import { BackgroundPills } from '../components/BackgroundPills';
import { Glass } from '../components/Glass';

export type ChatShell = { id: string; command: string };

/**
 * 聊天页：整条磨砂标题栏 + 消息流（尾部提问卡/状态行）+ 底部浮层（后台胶囊 + 输入卡）。
 * 列表铺满整页并延伸到输入卡下方，玻璃才有内容可透；底部留白由浮层实测高度决定。
 */
export function ChatScreen({ title, messages, pendingAsk, onAnswerSubmit,
  backgroundShells, backgroundAgents, onOpenShellOutput, onStopShell, onStopAgent,
  running, mintStatus, mintIcon, composer, onBack }: {
  title: string;
  connection: ConnectionStatus;
  messages: DisplayMessage[];
  pendingAsk: PendingAsk | null;
  onAnswerSubmit: (answers: AskAnswer[] | null) => void;
  backgroundShells: BackgroundShell[];
  backgroundAgents: BackgroundAgent[];
  onOpenShellOutput: (shell: ChatShell) => void;
  onStopShell: (id: string) => void;
  onStopAgent: (id: string, index: number) => void;
  running: boolean;
  mintStatus: string;
  mintIcon: string;
  composer: ComposerProps;
  onBack: () => void;
}): React.ReactElement {
  const floatingRef = useRef<HTMLDivElement>(null);
  const [floatingHeight, setFloatingHeight] = useState(0);

  // 浮层高度随菜单/附件/多行输入变化：量实际盒高（含输入卡 26 的底部外边距），给列表等量底部内边距。
  useEffect(() => {
    const node = floatingRef.current;
    if (!node) return;
    const measure = (): void => setFloatingHeight(node.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // key=requestId：同一时刻可能有多条挂起请求排队，前一条答完后避免复用本地 state
  const tail = useMemo(
    () => pendingAsk ? <AskCard key={pendingAsk.requestId} ask={pendingAsk} onSubmit={onAnswerSubmit} /> : null,
    [pendingAsk, onAnswerSubmit],
  );

  return (
    <div className="screen chat-screen">
      <div className="chat-blur-target">
        <MessageList messages={messages} running={running} tail={tail}
          // 顶部留白 = 标题栏 54 + 状态栏（页面已铺到屏幕顶，标题栏玻璃从 y=0 开始）
          askId={pendingAsk?.requestId} bottomInset={floatingHeight}
          topInset="calc(54px + env(safe-area-inset-top))"
          statusText={running ? mintStatus : ''} statusIcon={mintIcon} />
        <div className="chat-fade" aria-hidden="true" />
      </div>

      <div className="chat-topbar">
        <div className="chat-topbar-glass" aria-hidden="true">
          <Glass blur radius={0} elevated={false} rim="none" className="chat-topbar-fill" />
        </div>
        <Header title={title} onBack={onBack} />
      </div>

      <div className="chat-floating" ref={floatingRef}>
        <BackgroundPills shells={backgroundShells} agents={backgroundAgents}
          onOpenShellOutput={onOpenShellOutput} onStopShell={onStopShell} onStopAgent={onStopAgent} />
        <Composer {...composer} />
      </div>
    </div>
  );
}
