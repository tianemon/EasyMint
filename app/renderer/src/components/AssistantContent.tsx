import { useMemo, type ReactNode, type HTMLAttributes } from 'react';
import { appText, uiText } from '../lib/i18n';
import type { StreamEntry } from './StreamPanel';
import { buildBlocks, ChatBlockView } from './ChatBlocks';

import { assistantSegments } from './chat-message-presentation';
import { toolArguments } from './tool-activity';

export function AssistantContent({ entries, conclusions, messageId, toolInputs, streaming, actions, actionEvents, initiallyExpanded, readOnlyQuestions = false }: {
  entries: StreamEntry[];
  conclusions: readonly StreamEntry[];
  messageId: string;
  toolInputs: Map<string, Record<string, unknown>>;
  streaming: boolean;
  initiallyExpanded?: boolean;
  readOnlyQuestions?: boolean;
  actions?: ReactNode;
  actionEvents?: HTMLAttributes<HTMLDivElement>;
}) {
  const segments = useMemo(() => assistantSegments(entries, conclusions).map((segment, index) => ({
    ...segment, blocks: buildBlocks(segment.entries, `${messageId}-${index}`, toolInputs),
  })), [entries, conclusions, messageId, toolInputs]);
  const lastConclusion = segments.reduce((last, segment, index) => segment.conclusion ? index : last, -1);
  return <div className="assistant-content-flow">{segments.map((segment, index) => (
    <div key={index} className={segment.conclusion ? 'msg-conclusion msg-bubble-agent' : 'msg-process-stack'}
      {...(segment.conclusion ? actionEvents : {})}>
      {segment.blocks.map((block, i) => block.kind === "system" ? <div key={`${messageId}-${index}-${i}`} role="alert" className="text-danger">{appText(block.message)}</div>
        : readOnlyQuestions && block.kind === "tool-group" && block.items.some(item => item.name === "ask_user")
          ? <div className="assistant-content-flow" key={`${messageId}-${index}-${i}`}>{block.items.map((item, itemIndex) => item.name === "ask_user"
            ? <ReadOnlyQuestion key={item.id ?? itemIndex} input={item.input} result={item.result} />
            : <ChatBlockView key={item.id ?? itemIndex} block={{...block,items:[item]}} streaming={streaming} initiallyExpanded={initiallyExpanded} />)}</div>
          : <ChatBlockView key={`${messageId}-${index}-${i}`} block={block}
        streaming={streaming} initiallyExpanded={initiallyExpanded} isStreamingTail={streaming && index === segments.length - 1 && i === segment.blocks.length - 1} />)}
      {index === lastConclusion && actions}
    </div>
  ))}</div>;
}

function ReadOnlyQuestion({input,result}:{input:unknown;result?:string}): JSX.Element {
  const args=toolArguments(input);
  const questions=Array.isArray(args.questions)?args.questions:[];
  return <div className="execution-question">
    <div className="text-text-secondary">{uiText("ui.ChatBlocks.askQuestion")}</div>
    {questions.map((value,index)=>{
      const question=toolArguments(value);
      return <div key={index}><p>{typeof question.question === "string" ? question.question : ""}</p>
        {Array.isArray(question.options) && <ul>{question.options.map((option,i)=><li key={i}>{typeof option === "string" ? option : String(toolArguments(option).label ?? "")}</li>)}</ul>}
      </div>;
    })}
    {result && <pre className="whitespace-pre-wrap">{result}</pre>}
  </div>;
}
