/**
 * 供应商账号登录（OAuth）载荷类型 —— 主进程桥接层与渲染层共用。
 *
 * SDK 的 AuthEvent 带英文 message/instructions，按要求不上屏：主进程按事件类型转成本文件的
 * UI 事件（不含英文原文，只留结构化数据），渲染层按 kind 自写中文文案。
 */

export type ProviderAuthType = "api_key" | "oauth";

/** 供应商账号登录状态（IPC provider:authStatus 的返回项） */
export interface ProviderAuthStatus {
  providerId: string;
  /** SDK 声明的供应商显示名（预设表查不到时的兜底展示名） */
  name: string;
  /** 该供应商是否支持账号登录（SDK 的 provider.auth 含 oauth） */
  supportsOAuth: boolean;
  /** 当前生效的认证方式（含环境变量等外部来源）；null = 无可用凭据 */
  type: ProviderAuthType | null;
  /** auth.json 中是否存有该供应商的凭据（账号登录/落盘 API Key 的结果） */
  hasCredential: boolean;
  /** 凭据来源说明（OAuth / 环境变量名等），仅用于排查，不进界面主文案 */
  source?: string;
}

/** 账号登录流程的结果（IPC provider:authLogin / provider:authLogout 的返回项） */
export interface ProviderLoginResult {
  ok: boolean;
  /** ok=false 时：用户主动取消（区别于失败） */
  canceled?: boolean;
  /** ok=false 时：失败原因（SDK 原文，供展示细节与排查） */
  error?: string;
}

/** 选择类输入的候选项 */
export interface ProviderAuthPromptOption {
  id: string;
  label: string;
  description?: string;
}

/** 登录过程中推给界面的事件（英文 message 只在主进程留日志，不进本结构） */
export type ProviderAuthUiEvent =
  /** 授权链接已就绪（主进程同时已尝试用系统浏览器打开） */
  | { kind: "browser"; url: string }
  /** 设备码：需用户在浏览器输入 userCode */
  | { kind: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  /** 需要用户输入/选择（文案由渲染层按 promptType 自写） */
  | { kind: "prompt"; promptType: "text" | "secret" | "select" | "manual_code"; placeholder?: string; options?: ProviderAuthPromptOption[] }
  /** 流程仍在进行（如换 token），界面展示等待态即可 */
  | { kind: "progress" };

/** IPC provider:authEvent 的载荷 */
export interface ProviderAuthEventMessage {
  requestId: string;
  providerId: string;
  event: ProviderAuthUiEvent;
}

/** IPC provider:authInput 的载荷（渲染层提交某一步的输入） */
export interface ProviderAuthInputPayload {
  requestId: string;
  value: string;
}
