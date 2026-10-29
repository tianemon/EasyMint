/**
 * Codex（ChatGPT 订阅）额度视图 —— 主进程与渲染层共用。
 *
 * 字段对应 ChatGPT 后端 `wham/usage` 与 `wham/rate-limit-reset-credits` 的返回（无公开文档，
 * 解析与降级策略见 `app/main/services/codex-usage.ts`）。这里只放"解析完之后"的形状，
 * 不出现任何 token 或账号标识。
 */

/** 一个额度窗口（5 小时 / 7 天） */
export interface CodexQuotaWindow {
  /** 已用百分比（0–100） */
  usedPercent: number;
  /** 窗口长度（秒）：18000 = 5 小时，604800 = 7 天 */
  windowSeconds: number;
  /** 重置时间（Unix 秒） */
  resetAt?: number;
  /** 该窗口是否已触顶 */
  reached: boolean;
}

/** 一张「重置凭据」：消耗一次即可清空额度窗口 */
export interface CodexResetCredit {
  id: string;
  title?: string;
  /** 发放 / 到期时间（ISO 8601，UTC） */
  grantedAt?: string;
  expiresAt?: string;
}

export interface CodexQuotaView {
  plan?: string;
  /** 5 小时滚动窗口 */
  primary?: CodexQuotaWindow;
  /** 7 天窗口 */
  secondary?: CodexQuotaWindow;
  credits: { available: number; items: CodexResetCredit[] };
  fetchedAt: number;
}

/** 拿不到额度的原因：无凭据 / 需重新登录 / 网络 / 接口形态变了 */
export type CodexQuotaFailure = "no-credential" | "reauth" | "network" | "unsupported";
export type CodexQuotaResult = { ok: true; quota: CodexQuotaView } | { ok: false; reason: CodexQuotaFailure };

/** 消耗重置的结果码（后端四个 code + 我们补的 error） */
export type ConsumeResetCode = "reset" | "nothing_to_reset" | "no_credit" | "already_redeemed" | "error";
export interface ConsumeResetResult {
  code: ConsumeResetCode;
  /** 本次实际被清空的窗口数 */
  windowsReset?: number;
  error?: string;
}
