/** 流式条目类型 — 仅类型导出。
 *  StreamPanel 组件 / normalizeEvent / StreamEntryView 等 v2 展示层已废弃删除
 *  （Pi 迁移后无渲染处，ChatPanel 仅使用 StreamEntry 类型）。 */

export interface TextEntry {
  kind: "text";
  text: string;
  timestamp: number;
  source?: string;
}

interface ToolUseEntry {
  kind: "tool_use";
  id?: string;
  name: string;
  input: unknown;
  timestamp: number;
  collapsed: boolean;
  source?: string;
}

interface ToolResultEntry {
  kind: "tool_result";
  toolUseId: string;
  content: string;
  isError: boolean;
  timestamp: number;
  source?: string;
}

interface SystemEntry {
  kind: "system";
  message: string;
  timestamp: number;
  source?: string;
}

interface ErrorEntry {
  kind: "error";
  data: string;
  timestamp: number;
  source?: string;
}

interface ExitEntry {
  kind: "exit";
  code: number;
  timestamp: number;
  source?: string;
}

interface UserMessageEntry {
  kind: "user_message";
  text: string;
  timestamp: number;
  source?: string;
}

interface ThinkingEntry {
  kind: "thinking";
  text: string;
  timestamp: number;
  source?: string;
}

export type StreamEntry =
  | TextEntry
  | ThinkingEntry
  | ToolUseEntry
  | ToolResultEntry
  | SystemEntry
  | ErrorEntry
  | ExitEntry
  | UserMessageEntry;
