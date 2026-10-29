import { useMemo, type ReactNode, type HTMLAttributes } from 'react';
import { appText } from '../lib/i18n';
import type { StreamEntry } from './StreamPanel';
import { buildBlocks, ChatBlockView } from './ChatBlocks';

import { assistantSegments } from './chat-message-presentation';

export function AssistantContent({ entries, conclusions, messageId, toolInputs, streaming, actions, actionEvents, initiallyExpanded }: {
  entries: StreamEntry[];
  conclusions: readonly StreamEntry[];
  messageId: string;
  toolInputs: Map<string, Record<string, unknown>>;
  streaming: boolean;
  initiallyExpanded?: boolean;
  actions?: ReactNode;
  actionEvents?: HTMLAttributes<HTMLDivElement>;
}) {
  const segments = useMemo(() => assistantSegments(entries, conclusions).map((segment, index) => ({
    ...segment, blocks: buildBlocks(segment.entries, `${messageId}-${index}`, toolInputs),
  })), [entries, conclusions, messageId, toolInputs]);
  const lastConclusion = segments.reduce((last, segment, index) => segment.conclusion ? index : last, -1);
  return <>{segments.map((segment, index) => (
    <div key={index} className={segment.conclusion ? 'msg-conclusion msg-bubble-agent' : 'msg-process-stack'}
      {...(segment.conclusion ? actionEvents : {})}>
      {segment.blocks.map((block, i) => block.kind === "system" ? <div key={`${messageId}-${index}-${i}`} role="alert" className="text-danger">{appText(block.message)}</div> : <ChatBlockView key={`${messageId}-${index}-${i}`} block={block}
        streaming={streaming} initiallyExpanded={initiallyExpanded} isStreamingTail={streaming && index === segments.length - 1 && i === segment.blocks.length - 1} />)}
      {index === lastConclusion && actions}
    </div>
  ))}</>;
}
