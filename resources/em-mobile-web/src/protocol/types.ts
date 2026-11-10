export const PROTOCOL_VERSION = 1 as const;

export type PermissionMode = 'readonly' | 'standard' | 'full';
export type CommandName =
  | 'project.listOpen'
  | 'project.list'
  | 'project.open'
  | 'session.list'
  | 'session.create'
  | 'session.snapshot'
  | 'session.view'
  | 'session.send'
  | 'session.steer'
  | 'session.abort'
  | 'session.setModel'
  | 'session.setThinking'
  | 'session.setPermission'
  | 'session.answerAsk'
  | 'session.rename'
  | 'session.pin'
  | 'session.archive'
  | 'shell.stop'
  | 'shell.readLog'
  | 'delegation.stop'
  | 'capability.models';

export interface PairingOffer {
  version: 1;
  token: string;
  pcId: string;
  pcName: string;
  addresses: string[];
  port: number;
  publicKey: string;
  expiresAt: number;
}

export interface PcCredential {
  version: 1;
  pcId: string;
  pcName: string;
  addresses: string[];
  port: number;
  deviceId: string;
  deviceName: string;
  sharedSecret: string;
}

export interface RemoteEnvelope {
  version: 1;
  connectionId: string;
  sequence: number;
  sentAt: number;
  kind: 'command' | 'result' | 'event' | 'snapshot';
  requestId?: string;
  projectId?: string;
  sessionId?: string;
  payload: unknown;
}

export interface OpenProject {
  id: string;
  name: string;
  status: 'setup' | 'development' | 'completed';
  /** project.list 返回：桌面端当前是否已有该项目的窗口（未打开时先发 project.open）。 */
  open?: boolean;
}

export interface SessionListItem {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  lastMessage?: string;
  pinnedAt?: number;
  archivedAt?: number;
  /** PC 侧由 sessionAgentTypes 标记的会话类型（mint/builder/evaluator/designer） */
  agentType?: string;
}

export interface PendingAsk {
  requestId: string;
  sessionId: string;
  /** 题目（字段与桌面端 ask-store 的 AskQuestion 同形；提问卡按 PC 的单题导航式渲染） */
  questions: Array<{
    id: string;
    question: string;
    options?: Array<{ value: string; label: string; description?: string; recommended?: boolean }>;
    /** 多选：勾选不跳题，靠主按钮「下一题/完成」前进 */
    multi_select?: boolean;
    /** 级联：{前置问题id: 选项value}，前置选择匹配才显示本问题 */
    depends_on?: Record<string, string>;
  }>;
  allowCustom: boolean;
  createdAt: number;
}

export interface SessionSnapshot {
  session: SessionListItem;
  messages: Array<{
    type: 'user' | 'assistant' | 'toolResult';
    uuid: string;
    message: unknown;
    created_at?: number;
    /** 桌面端 session-service.ts:284-285 的轻档标记：条目仍在历史里，但已移出模型上下文 / 图片已从上下文剥离 */
    out_of_context?: boolean;
    image_stripped?: boolean;
  }>;
  cache?: {
    model?: string;
    thinkingLevel?: string;
    permissionMode?: PermissionMode;
  };
  status: string;
  thinking?: { level?: string; available?: string[] };
  pendingAsks: PendingAsk[];
  bufferedEvents: unknown[];
  eventSequence?: number;
  background?: {
    shells: BackgroundShell[];
    agents: BackgroundAgent[];
  };
}

export interface BackgroundShell {
  id: string;
  command: string;
  startedAt: number;
  status: 'running' | 'stopping';
  output?: string;
  sessionId?: string;
}

export interface BackgroundAgent {
  delegationId: string;
  index: number;
  title: string;
  /** 'stopping' 是手机端自己的乐观态（点了停止、还没等到 PC 的 agent:delegation-count 回写）；PC 只下发其余五个值 */
  status?: 'pending' | 'running' | 'stopping' | 'completed' | 'failed' | 'aborted';
  currentTool?: string;
  sessionId?: string;
}

export interface ModelCapabilities {
  features?: { sessionView?: boolean; projectBrowse?: boolean };
  currentProvider: string | null;
  providers: Array<{
    id: string;
    name: string;
    currentModel: string;
    models: Array<{ id: string; name: string; thinkingLevels?: string[] | null }>;
  }>;
}

export interface RemoteEvent {
  channel: string;
  data: unknown;
  eventSequence?: number;
  emittedAt?: number;
}
