/**
 * Pi Chat Event 类型定义（占位 — 步骤三实现 event-bridge 时替换为正式定义）
 */

/** 替代 Claude SDK 的 SDKMessage */
export interface SDKMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: unknown;
  [key: string]: unknown;
}
