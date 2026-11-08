import type { BackgroundAgent, BackgroundShell, PendingAsk, PermissionMode } from '../protocol/types';
import type { ContextUsage } from './types';
import type { DisplayMessage } from './messages';

/**
 * 会话级运行态 —— 与桌面端 chat-store 同构（那边是 `messagesBySession` + 各会话自己的 busy 等）。
 *
 * **为什么必须是「每会话一份」而不是「一份全局状态 + 按当前会话过滤」**：
 * 过滤依赖「当前会话」这个可变量，而事件回调、异步快照、用户动作三者时序交错——
 * 只要有一条路径在过滤生效前后写进全局状态，就会串到别的会话（切换会话时发送按钮、
 * 状态文案串会话就是这么来的）。改成按会话 id 落格后，写入方只需给出**事件自己的会话 id**，
 * 显示哪份由界面决定，串会话在结构上不可能发生。
 *
 * 未创建的新会话用 `DRAFT_SESSION_ID` 占位：`session.send` 返回真实 id 后迁移过去。
 */
export const DRAFT_SESSION_ID = '__draft__';

export type SessionRuntime = {
  messages: DisplayMessage[];
  running: boolean;
  /** 状态行文案（空 = 不显示） */
  mintStatus: string;
  /** 状态行图标（工具进行中显示该工具的图标，空 = 用 Mint 的模型图标，桌面端 StatusBar 同款） */
  mintIcon: string;
  /**
   * 上下文整理中：桌面端此时会蒙住输入卡片并禁用发送（ChatInput.tsx:421-441，inputDisabled）。
   * 手机端同款——否则用户能在压缩期间照常打字发送，等 PC 拒绝才知道不行。
   */
  compacting: boolean;
  pendingAsk: PendingAsk | null;
  backgroundShells: BackgroundShell[];
  backgroundAgents: BackgroundAgent[];
  contextUsage: ContextUsage;
  permission: PermissionMode;
  thinking: string;
  thinkingOptions: string[];
  model: string;
};

/** 没有任何事件/快照到达前的默认值（也用于新会话草稿格的初次写入） */
export const EMPTY_RUNTIME: SessionRuntime = {
  messages: [],
  running: false,
  mintStatus: '',
  mintIcon: '',
  compacting: false,
  pendingAsk: null,
  backgroundShells: [],
  backgroundAgents: [],
  contextUsage: { percent: null },
  permission: 'standard',
  thinking: 'medium',
  thinkingOptions: [],
  model: '',
};

/** 会话级状态的写入器签名（按会话 id 落格） */
export type RuntimePatch =
  | Partial<SessionRuntime>
  | ((current: SessionRuntime) => Partial<SessionRuntime>);

export type PatchRuntime = (sessionId: string, patch: RuntimePatch) => void;
