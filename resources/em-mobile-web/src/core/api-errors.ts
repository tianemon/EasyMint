/**
 * API 错误归一化 —— 镜像桌面端 `app/shared/api-errors.ts`（逐条同表、同序、同文案）。
 *
 * 桌面端在主进程与渲染层共用这张表：把上游 LLM / 网络栈的原始错误（英文技术壳、JSON 片段、
 * 堆栈）转成面向用户的中文提示。手机端手里只有 `agent:stream` 的 `type: 'error'` 帧，
 * 载荷是原始 message，所以要在这一侧做同样的归一化——否则 429/503 会原样铺成
 * "Error: 503 Service Unavailable"，与桌面端说的不是同一句话。
 *
 * 两条纪律沿用桌面端：
 * - **一份表**：每条规则同时匹配「上游原文」与「本表产出的中文」（主进程已归一化的路径传到
 *   手机端时已是中文，靠中文分支命中）；也支持直接用 `code` 命中。
 * - **只说用户能感知的事**：发生了什么 + 可以做什么；不写内部机制、不带请求 ID 与堆栈。
 *
 * 顺序敏感：具体在前、宽泛在后（413 先于其它 4xx，超时先于网络抖动）。改这里要同步桌面端。
 */

export type ApiErrorCode = 'stopped' | 'request_too_large' | 'context_limit' | 'authentication'
  | 'quota' | 'forbidden' | 'model_missing' | 'rate_limit' | 'service_unavailable' | 'timeout'
  | 'connection' | 'network' | 'certificate' | 'invalid_response' | 'compacting' | 'unknown';

/** warn = 暂时性、可自愈（限流/繁忙/超时/抖动）；error = 需要用户处理或明确失败 */
export type ErrorTone = 'warn' | 'error';

export type ApiErrorInfo = {
  code: ApiErrorCode;
  tone: ErrorTone;
  /** 面向用户的一句话（说清发生了什么） */
  message: string;
  /** 简短建议（可选，纯文案，不产生动作按钮） */
  hint?: string;
  kind?: 'request_too_large';
};

type ErrorRule = {
  code: ApiErrorCode;
  re: RegExp;
  tone: ErrorTone;
  message: string;
  hint?: string;
  kind?: 'request_too_large';
};

const RULES: ErrorRule[] = [
  // 用户主动打断（abort）是正常副作用，不是错误
  { code: 'stopped', re: /abort|operation was aborted|cancel+ed|已停止/i, tone: 'warn', message: '已停止' },
  // 请求体超限——网关/代理在缓冲请求体时拒绝，只有改小请求体才有用，重试无效
  {
    code: 'request_too_large',
    re: /413|request_too_large|request exceeds the maximum size|payload too large|request entity too large|failed to buffer the request body|length limit exceeded|请求内容太大/i,
    tone: 'error',
    message: '请求内容太大，超出服务商能接收的上限',
    hint: '可整理历史图片后重试，或减少本次附件',
    kind: 'request_too_large',
  },
  // 上下文超限（模型侧的 token 上限）
  {
    code: 'context_limit', re: /context length|maximum context|context window|too many tokens|prompt is too long|reduce the length|对话内容超出/i,
    tone: 'error',
    message: '对话内容超出模型上限',
    hint: '压缩会话后可继续',
  },
  {
    code: 'authentication', re: /401|unauthorized|invalid api key|incorrect api key|authentication failed|密钥无效/i,
    tone: 'error',
    message: '密钥无效或已过期',
    hint: '到设置里检查该服务商的凭据',
  },
  {
    code: 'quota', re: /402|insufficient_quota|quota exceeded|insufficient balance|billing|账户额度不足|余额不足/i,
    tone: 'error',
    message: '账户额度不足',
    hint: '检查服务商余额或额度',
  },
  { code: 'forbidden', re: /403|forbidden|not available in your region|无权限/i, tone: 'error', message: '无权限使用该模型' },
  {
    code: 'model_missing', re: /404|model not found|unknown model|does not exist|模型不存在/i,
    tone: 'error',
    message: '模型不存在或已下线',
    hint: '到设置里换一个可用模型',
  },
  { code: 'rate_limit', re: /429|rate.?limit|too many requests|请求过于频繁/i, tone: 'warn', message: '请求过于频繁，稍后再试' },
  {
    code: 'service_unavailable', re: /50[0234]|service_unavailable|service is too busy|overloaded|internal server error|bad gateway|服务繁忙|服务暂时不可用/i,
    tone: 'warn',
    message: 'AI 服务暂时不可用',
    hint: '稍后再试，或换一个模型/服务商',
  },
  { code: 'timeout', re: /timeout|timed out|ETIMEDOUT|超时/i, tone: 'warn', message: '请求超时，稍后再试' },
  {
    code: 'connection', re: /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo|连接被拒绝/i,
    tone: 'error',
    message: '无法连接到服务地址',
    hint: '检查网络、代理与服务商地址',
  },
  {
    code: 'network', re: /fetch failed|network ?error|ECONNRESET|connection reset|socket hang up|EPIPE|premature close|stream (ended|closed)|\bterminated\b|网络连接中断/i,
    tone: 'warn',
    message: '网络连接中断，稍后再试',
  },
  {
    code: 'certificate', re: /certificate|self[ -]signed|unable to verify|\bSSL\b|\bTLS\b|安全连接失败/i,
    tone: 'error',
    message: '安全连接失败',
    hint: '检查代理或证书设置',
  },
  { code: 'invalid_response', re: /unexpected token|invalid json|JSON\.parse|无法解析/i, tone: 'error', message: '服务端返回了无法解析的内容' },
  // 压缩进行中拒绝新 prompt（EM 自身文案）：等一会儿即可
  { code: 'compacting', re: /正在整理上下文/i, tone: 'warn', message: '正在整理上下文，请稍候再试' },
];

/** 未命中规则时：取首行有效内容，去掉 "Error:" 前缀与换行，超长截断 */
function cleanupRaw(message: string): string {
  const first = message.split('\n').map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  const cleaned = first.replace(/^Error:\s*/i, '').replace(/\s+/g, ' ');
  return cleaned.length > 160 ? `${cleaned.slice(0, 160)}…` : cleaned;
}

/** 分类：返回视觉档位 + 面向用户的文案。未识别的错误保留原文（截断），便于用户反馈定位 */
export function classifyApiError(error: unknown): ApiErrorInfo {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const codedRule = RULES.find((rule) => rule.code === code);
  for (const rule of RULES) {
    if (codedRule ? rule === codedRule : rule.re.test(raw)) {
      return {
        code: rule.code,
        tone: rule.tone,
        message: rule.message,
        ...(rule.hint ? { hint: rule.hint } : {}),
        ...(rule.kind ? { kind: rule.kind } : {}),
      };
    }
  }
  return { code: 'unknown', tone: 'error', message: cleanupRaw(raw) || '请求失败' };
}
