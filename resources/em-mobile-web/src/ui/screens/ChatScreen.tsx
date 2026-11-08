import type { ReactNode } from 'react';
import type { AskAnswer } from '../../core/types';
import type { BackgroundAgent, BackgroundShell, PendingAsk } from '../../protocol/types';
import type { DisplayMessage } from '../../core/messages';
import type { ConnectionStatus } from '../../core/types';
import { Header } from '../components/Header';
import { MessageList } from '../components/MessageList';
import { MintStatus } from '../components/MintStatus';
import { Composer } from '../components/Composer';
import type { ComposerProps } from '../components/Composer';
import { AskCard } from '../components/AskCard';
import { Icon } from '../components/icons';
import { t } from '../i18n';

export type ChatShell = { id: string; command: string };

function BackgroundBar({ shells, agents, onOpenShellOutput, onStopShell, onStopAgent }: {
  shells: BackgroundShell[];
  agents: BackgroundAgent[];
  onOpenShellOutput: (shell: ChatShell) => void;
  onStopShell: (id: string) => void;
  onStopAgent: (id: string, index: number) => void;
}): React.ReactElement | null {
  if (!shells.length && !agents.length) return null;
  return (
    <div className="background-bar">
      {shells.map((shell) => (
        <div key={shell.id} className="background-row">
          <Icon name="bash" size={13} />
          <button type="button" className="background-label" onClick={() => onOpenShellOutput({ id: shell.id, command: shell.command })}>
            {shell.command}
          </button>
          <span className={`background-state${shell.status === 'running' ? ' is-running' : ''}`}>
            {shell.status === 'running' ? '运行中' : '停止中'}
          </span>
          <button type="button" className="background-stop" onClick={() => onStopShell(shell.id)}>{t('app.stop')}</button>
        </div>
      ))}
      {agents.map((agent) => (
        <div key={`${agent.delegationId}-${agent.index}`} className="background-row">
          <Icon name="bot" size={13} />
          <span className="background-label">{agent.title}</span>
          <span className="background-state">{agent.currentTool ?? agent.status ?? '任务'}</span>
          <button type="button" className="background-stop" onClick={() => onStopAgent(agent.delegationId, agent.index)}>{t('app.stop')}</button>
        </div>
      ))}
    </div>
  );
}

export function ChatScreen({ title, connection, messages, pendingAsk, onAnswerSubmit,
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
  const footer: ReactNode = (
    <>
      <BackgroundBar shells={backgroundShells} agents={backgroundAgents}
        onOpenShellOutput={onOpenShellOutput} onStopShell={onStopShell} onStopAgent={onStopAgent} />
      {pendingAsk && <AskCard ask={pendingAsk} onSubmit={onAnswerSubmit} />}
      <MintStatus text={mintStatus} icon={mintIcon} running={running} />
    </>
  );
  return (
    <div className="screen chat-screen">
      <Header title={title} onBack={onBack} connected={connection === 'connected'} />
      <MessageList messages={messages} running={running} footer={footer} />
      <Composer {...composer} />
    </div>
  );
}
