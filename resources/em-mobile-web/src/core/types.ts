import type { OpenProject, SessionListItem } from '../protocol/types';

/** 页面路由（App 根状态） */
export type Page = 'home' | 'scanner' | 'projects' | 'sessions' | 'chat' | 'settings';

/** 与电脑端的连接状态（RemoteClient.onStatus 上报） */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/** 首页「项目 + 会话」组合 */
export type HomeSession = { project: OpenProject; session: SessionListItem };

/** 上下文用量（agent:context-usage 事件） */
export type ContextUsage = { percent: number | null; maxTokens?: number };

/** 后台命令日志尾部（PC 的 shell.readLog 返回体；手机端「查看完整输出」用它做首屏数据） */
export type ShellLog = { content: string; truncated: boolean };

/** 提问卡的一次提交（对应 PC respondAsk 的列表形态；空列表/null = 用户取消提问） */
export type AskAnswer = { questionId: string; values: string[] };

/** 输入卡工具菜单当前展开的控制项（attachment 为回形针的图片/文档菜单） */
export type ComposerControl = 'model' | 'permission' | 'thinking' | 'attachment' | null;
