import { useState } from 'react';
import type { DisplayNestedCall, DisplayToolBlock } from '../../core/messages';
import { truncateToolOutput } from '../../core/messages';
import { diffLines, diffStats, numberLines, visibleDiffRange } from '../../core/diff';
import { isCommandTool, toolCommand, toolDescription, toolDisplay, toolLabel } from '../../core/tools';
import { ChevronIcon, Icon, SpinIcon, ToolIcon, iconSize } from './icons';

/** 展开区高度上限：对齐 PC 的 calc(var(--text-detail) * 9.75 + 28px)（约 6 行 + 内边距） */
const BASH_BODY_MAX_HEIGHT = 13 * 9.75 + 28;
const TEXT_BODY_MAX_HEIGHT = 220;
const BASH_LINE_HEIGHT = 1.625;

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) || path;
}

function filePathOf(input: Record<string, unknown> | undefined): string {
  const value = input?.file_path ?? input?.path;
  return typeof value === 'string' ? value : '';
}

function StateGlyph({ tool, live }: { tool: DisplayToolBlock; live: boolean }): React.ReactElement {
  if (tool.state === 'running') {
    return live ? <SpinIcon size={iconSize.card} className="tool-spin" /> : <span className="tool-duration">未完成</span>;
  }
  return tool.state === 'error'
    ? <Icon name="cross" size={iconSize.status} className="tool-state-error" />
    : <Icon name="check" size={iconSize.status} className="tool-state-ok" />;
}

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

/** 子 Agent 内部的一次调用：一行摘要，点开看参数 JSON。 */
function NestedRow({ call, pending }: { call: DisplayNestedCall; pending: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const status = call.status === 'error' ? '失败' : call.status === 'unfinished' ? (pending ? '执行中' : '未完成') : '完成';
  const intent = typeof call.arguments?.description === 'string' ? String(call.arguments.description)
    : typeof call.arguments?.file_path === 'string' ? basename(String(call.arguments.file_path))
      : typeof call.arguments?.path === 'string' ? basename(String(call.arguments.path)) : '';
  return (
    <div className="nested-item">
      <button type="button" className="nested-row" onClick={() => setOpen((value) => !value)}>
        <span className="nested-line">
          {intent || call.name} · {status}{call.durationMs !== undefined ? ` · ${call.durationMs}ms` : ''}
        </span>
      </button>
      {open && (
        <pre className="nested-args">
          {call.arguments ? JSON.stringify(call.arguments, null, 2) : '参数未保留'}
          {call.error ? `\n${call.error}` : ''}
        </pre>
      )}
    </div>
  );
}

/**
 * 工具调用卡。形态按工具分叉，与 App ToolCard.tsx 逐项对齐：
 * read 一行到底；edit 展开堆叠 diff；write 展开带行号内容；bash 命令与输出都进展开区；
 * permission_denied 只在标题追加「需要完全访问」；子 Agent 调用挂在卡下方缩进。
 */
export function ToolCard({ tool, live = true }: { tool: DisplayToolBlock; live?: boolean }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const name = tool.name.toLowerCase();
  const input = tool.input ?? {};
  const commandTool = isCommandTool(tool.name);
  const command = commandTool ? toolCommand(input) : '';
  const description = commandTool ? toolDescription(input) : '';
  const label = toolLabel(tool.name);
  const filePath = filePathOf(input);
  const fileName = filePath ? basename(filePath) : '';
  const permission = tool.presentation?.kind === 'permission_denied' ? tool.presentation : undefined;
  const diff = tool.presentation?.kind === 'edit_diff' ? tool.presentation : undefined;
  const stats = diff ? diffStats(diff.diff, diff) : null;
  const writeContent = name === 'write' && typeof input.content === 'string' ? input.content : undefined;
  const writeLines = writeContent ? writeContent.split('\n').length : 0;

  const full = commandTool ? label : toolDisplay(tool);
  const detail = commandTool
    ? description
    : fileName || (full.startsWith(label) ? full.slice(label.length).replace(/^ · /, '') : full);
  const hasBody = permission ? false
    : diff || writeContent !== undefined ? true
      : commandTool ? (!!command || !!tool.output)
        : !!tool.output;
  const duration = typeof tool.durationMs === 'number' ? `${(tool.durationMs / 1000).toFixed(1)}s` : '';

  if (name === 'read') {
    return (
      <div className="tool-card is-read">
        <div className="tool-row">
          <div className="tool-title-row">
            <ToolIcon name={tool.name} />
            <span className="tool-label">{label}</span>
            <span className="tool-detail">{fileName || '(未知文件)'}</span>
            <StateGlyph tool={tool} live={live} />
            {duration && <span className="tool-duration">{duration}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tool-card">
      <button type="button" className="tool-row" disabled={!hasBody} onClick={() => setOpen((value) => !value)}>
        <div className="tool-title-row">
          <ToolIcon name={tool.name} />
          <span className="tool-label">{label}</span>
          {!!detail && <span className="tool-detail">{detail}</span>}
          {!!permission && <span className="tool-permission">· 需要完全访问</span>}
          {!!stats && (stats.added > 0 || stats.removed > 0) && (
            <span className="tool-stats">
              {stats.added > 0 && <span className="stat-add">+{stats.added}</span>}
              {stats.added > 0 && stats.removed > 0 && ' • '}
              {stats.removed > 0 && <span className="stat-remove">-{stats.removed}</span>}
            </span>
          )}
          {!!writeLines && <span className="tool-detail">{writeLines} 行</span>}
          <StateGlyph tool={tool} live={live} />
          {duration && <span className="tool-duration">{duration}</span>}
          {hasBody && <ChevronIcon size={iconSize.status} direction={open ? 'down' : 'right'} className="tool-chevron" />}
        </div>
      </button>

      {open && hasBody && (diff
        ? (
          <div className="tool-diff-body">
            <DiffView lines={diffLines(tool.output, diff)} />
          </div>
        )
        : writeContent !== undefined
          ? <pre className="tool-text-body" style={{ maxHeight: TEXT_BODY_MAX_HEIGHT }}>{numberLines(writeContent)}</pre>
          : commandTool
            ? (
              <div className="tool-bash-body" style={{ maxHeight: BASH_BODY_MAX_HEIGHT }}>
                {!!command && <pre className="tool-command">{command}</pre>}
                {!!tool.output && <pre className="tool-output">{tool.output}</pre>}
              </div>
            )
            : <pre className="tool-text-body" style={{ maxHeight: TEXT_BODY_MAX_HEIGHT }}>{truncateToolOutput(tool.output)}</pre>)}

      {!!tool.nested?.calls.length && (
        <div className="tool-nested">
          {tool.nested.calls.map((call) => <NestedRow key={call.id} call={call} pending={tool.state === 'running'} />)}
          {tool.state !== 'running' && !tool.nested.complete && <span className="tool-nested-note">部分嵌套调用或参数未保留</span>}
        </div>
      )}
    </div>
  );
}
