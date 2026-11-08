import { useState } from 'react';
import type { DisplayToolBlock } from '../../core/messages';
import { truncateToolOutput } from '../../core/messages';
import { diffLines, diffStats, numberLines, visibleDiffRange } from '../../core/diff';
import { isCommandTool, toolCommand, toolDescription, toolDisplay, toolStatus } from '../../core/tools';
import { Icon, toolIconName } from './icons';

function DiffView({ lines }: { lines: string[] }): React.ReactElement {
  const range = visibleDiffRange(lines);
  const from = range?.from ?? 0;
  const to = range?.to ?? lines.length - 1;
  return (
    <div className="diff-view">
      {range && from > 0 && <div className="diff-ellipsis">… 省略 {from} 行</div>}
      {lines.slice(from, to + 1).map((line, index) => {
        const kind = line.startsWith('+') && !line.startsWith('+++') ? 'add'
          : line.startsWith('-') && !line.startsWith('---') ? 'remove' : 'ctx';
        return <div key={index} className={`diff-line diff-${kind}`}>{line || ' '}</div>;
      })}
      {range && to < lines.length - 1 && <div className="diff-ellipsis">… 省略 {lines.length - 1 - to} 行</div>}
    </div>
  );
}

/** 工具卡：read / edit diff / write / bash / permission / nestedCalls 六种形态。 */
export function ToolCard({ tool }: { tool: DisplayToolBlock }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const running = tool.state === 'running';
  const failed = tool.state === 'error';
  const presentation = tool.presentation;
  const isDiff = presentation?.kind === 'edit_diff' || tool.name === 'edit';
  const isWrite = tool.name === 'write';
  const isBash = isCommandTool(tool.name);
  const lines = isDiff ? diffLines(tool.output, presentation) : [];
  const stats = isDiff ? diffStats(tool.output, presentation) : null;
  const summary = isBash ? (toolDescription(tool.input) || toolCommand(tool.input)) : '';
  const title = isBash ? (toolDisplay(tool).split(' · ')[0] ?? '命令') : toolDisplay(tool);
  const duration = typeof tool.durationMs === 'number' ? `${(tool.durationMs / 1000).toFixed(1)}s` : '';

  return (
    <div className={`tool-card tool-${tool.state}`}>
      <button type="button" className="tool-head" onClick={() => setOpen((value) => !value)}>
        <Icon name={toolIconName(tool.name)} size={14} />
        <span className="tool-title">{title}</span>
        {stats && (stats.added > 0 || stats.removed > 0) && (
          <span className="tool-stats"><span className="stat-add">+{stats.added}</span> <span className="stat-remove">-{stats.removed}</span></span>
        )}
        {duration && <span className="tool-duration">{duration}</span>}
        <span className={`tool-state${running ? ' is-running' : ''}${failed ? ' is-error' : ''}`}>
          {running ? '进行中' : failed ? '失败' : '完成'}
        </span>
        <Icon name={open ? 'chevronDown' : 'chevron'} size={12} />
      </button>

      {summary && <div className="tool-summary">{summary}</div>}

      {presentation?.kind === 'permission_denied' && (
        <div className="permission-card">
          <Icon name="shield" size={14} />
          <div>
            <div className="permission-title">操作被权限规则拦截</div>
            <div className="permission-detail">{presentation.rule} · {presentation.mode} · {presentation.operation} {presentation.target}</div>
            {presentation.detail && <div className="permission-detail">{presentation.detail}</div>}
          </div>
        </div>
      )}

      {isBash && toolCommand(tool.input) && <pre className="tool-command">{toolCommand(tool.input)}</pre>}

      {open && (
        <div className="tool-body">
          {isDiff ? <DiffView lines={lines} />
            : isWrite ? <pre className="tool-output tool-numbered">{numberLines(truncateToolOutput(tool.output, 30))}</pre>
              : <pre className="tool-output">{truncateToolOutput(tool.output, open ? 200 : 30)}</pre>}
          {tool.imagePath && <div className="tool-image-note"><Icon name="image" size={12} /> 图像：{tool.imagePath.split(/[\\/]/).pop()}</div>}
          {tool.nested && tool.nested.calls.length > 0 && (
            <div className="nested-calls">
              <div className="nested-title">内部调用 {tool.nested.complete ? '' : '（进行中）'}</div>
              {tool.nested.calls.map((call) => (
                <div key={call.id} className="nested-row">
                  <Icon name={toolIconName(call.name)} size={11} />
                  <span>{call.name}</span>
                  <span className={`nested-status nested-${call.status}`}>{call.status === 'ok' ? '完成' : call.status === 'error' ? '失败' : '未完成'}</span>
                  {typeof call.durationMs === 'number' && <span>{(call.durationMs / 1000).toFixed(1)}s</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {running && <div className="tool-running-hint">{toolStatus(tool.name)}…</div>}
    </div>
  );
}
