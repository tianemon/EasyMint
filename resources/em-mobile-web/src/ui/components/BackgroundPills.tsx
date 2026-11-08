import { useState } from 'react';
import type { BackgroundAgent, BackgroundShell } from '../../protocol/types';
import { Icon, SpinIcon, iconSize } from './icons';

export type BackgroundPillShell = { id: string; command: string };

/**
 * 后台任务胶囊：Agent / Shell 计数，点击展开当前执行清单。
 * 结构与文案逐项对齐 App components/BackgroundPills.tsx：
 *  - 同一时刻只展开一个面板；
 *  - Shell 行点命令打开输出页，Agent 行给「标题 · 当前工具」两行截断；
 *  - 已点停止时按钮换成「停止中…」，避免重复触发。
 */
export function BackgroundPills({ shells, agents, onOpenShellOutput, onStopShell, onStopAgent }: {
  shells: BackgroundShell[];
  agents: BackgroundAgent[];
  onOpenShellOutput: (shell: BackgroundPillShell) => void;
  onStopShell: (shellId: string) => void;
  onStopAgent: (delegationId: string, taskIndex: number) => void;
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState<'shell' | 'agent' | null>(null);
  if (!shells.length && !agents.length) return null;

  return (
    <div className="background-wrap">
      <div className="background-bar">
        {!!agents.length && (
          <button type="button" className="background-pill"
            onClick={() => setExpanded((value) => value === 'agent' ? null : 'agent')}>
            <Icon name="bot" size={iconSize.tool} className="background-pill-icon" />
            <span className="background-pill-text">Agent · {agents.length}</span>
          </button>
        )}
        {!!shells.length && (
          <button type="button" className="background-pill is-shell"
            onClick={() => setExpanded((value) => value === 'shell' ? null : 'shell')}>
            <Icon name="bash" size={iconSize.tool} className="background-pill-icon" />
            <span className="background-pill-text">Shell · {shells.length}</span>
          </button>
        )}
      </div>

      {expanded === 'agent' && (
        <div className="background-panel">
          <div className="background-panel-title">执行中的 Agent({agents.length})</div>
          {agents.map((agent) => (
            <div key={`${agent.delegationId}-${agent.index}`} className="background-row">
              <SpinIcon size={iconSize.pill} className="background-spin" />
              <span className="background-agent-text">{agent.title}{agent.currentTool ? ` · ${agent.currentTool}` : ''}</span>
              {agent.status === 'stopping'
                ? <span className="background-stopping">停止中…</span>
                : <button type="button" className="background-stop"
                  onClick={() => onStopAgent(agent.delegationId, agent.index)}>停止</button>}
            </div>
          ))}
        </div>
      )}

      {expanded === 'shell' && (
        <div className="background-panel">
          <div className="background-panel-title">运行中的 Shell({shells.length})</div>
          {shells.map((shell) => (
            <div key={shell.id} className="background-row">
              <SpinIcon size={iconSize.pill} className="background-spin" />
              <button type="button" className="background-shell-command"
                onClick={() => onOpenShellOutput({ id: shell.id, command: shell.command })}>
                <span className="background-shell-text">{shell.command}</span>
              </button>
              {shell.status === 'stopping'
                ? <span className="background-stopping">停止中…</span>
                : <button type="button" className="background-stop"
                  onClick={() => onStopShell(shell.id)}>停止</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
