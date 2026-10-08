/**
 * 工具调用的「意图」：让聊天页**不展开**也能知道这次调用在做什么。
 *
 * 两种来源，按可靠性排序：
 * 1. **`_intent`**（模型调用时填）——EM 自家工具在 schema 中声明，聊天页直接读取。
 *    codemode 嵌套调用仍保留这个参数。Pi MCP 使用服务器原始 schema，不再由 EM 注入该字段。
 * 2. **参数摘要**（`summarizeInput`）—— 老会话、或模型没填时的兜底：取参数里最有语义的
 *    那个字符串值（query / url / name …）。
 *
 * 字段名为什么是 `_intent` 而不是 `description`：server 的 schema 里**可能本来就有**
 * `description` 参数，撞了会覆盖真实参数。下划线前缀的冲突概率极低。
 */

/** EM 自家工具与历史会话使用的展示参数名。 */
export const INTENT_PARAM = "_intent";

/** Tool captions follow the user language; the instruction itself stays in Chinese. */
export const TOOL_DISPLAY_DESCRIPTION = "使用用户所用的语言，简短描述本次调用在做什么（不超过 28 字符，中文建议 ≤12 字）；仅用于聊天页展示";

/** EM 自家工具的意图填写说明。 */
export const INTENT_REQUIREMENT = `每次调用都要填 ${INTENT_PARAM}：${TOOL_DISPLAY_DESCRIPTION}，该字段不会传给工具。`;

/** 参数摘要的优先键：这些值最能说明"做了什么" */
const SUMMARY_KEYS = [
  "query", "q", "search", "keyword", "text", "prompt", "url", "path", "name", "title",
] as const;

/** 标题行展示的最大字符数（超了截断，完整值仍在展开区） */
const MAX_LEN = 28;

function clip(value: string): string {
  const s = value.trim().replace(/\s+/g, " ");
  return s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s;
}

/**
 * 取这次调用的意图。优先模型填的 `_intent`，没有则回退到参数摘要。
 * 取不到返回 undefined —— 调用方应**不显示**那段，而不是显示占位（标题行越短越好）。
 */
export function intentFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const rec = input as Record<string, unknown>;
  const intent = rec[INTENT_PARAM];
  if (typeof intent === "string" && intent.trim()) return clip(intent);
  return summarizeInput(rec);
}

/** 兜底：取第一个有语义的字符串参数（first-match，不拼接——标题行只放得下一件事） */
export function summarizeInput(input: Record<string, unknown>): string | undefined {
  for (const key of SUMMARY_KEYS) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return clip(v);
  }
  return undefined;
}

/**
 * 给工具 schema 加 `_intent` 可选字段。
 * 防御优先：schema 来自第三方，可能没有 `properties`、可能是布尔 schema —— 无法安全改写时
 * **原样返回**（宁可没有意图字段，也不能把工具搞挂）。
 */
export function withIntentParam<T>(schema: T): T {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const s = schema as Record<string, unknown>;
  if (s.type !== "object") return schema;
  const props = s.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return schema;
  if (INTENT_PARAM in (props as Record<string, unknown>)) return schema; // server 已占用：不覆盖
  return {
    ...s,
    properties: {
      ...(props as Record<string, unknown>),
      [INTENT_PARAM]: {
        type: "string",
        description: `${TOOL_DISPLAY_DESCRIPTION}，不会传给工具`,
      },
    },
  } as unknown as T; // 结构与入参同型（只多一个可选字段），调用处无需断言
}

/** 转发给 server 前剥掉 `_intent`（无该字段时返回原对象，避免无谓拷贝） */
export function stripIntentParams<T>(params: T): T {
  if (!params || typeof params !== "object" || Array.isArray(params)) return params;
  const rec = params as Record<string, unknown>;
  if (!(INTENT_PARAM in rec)) return params;
  const { [INTENT_PARAM]: _dropped, ...rest } = rec;
  return rest as T;
}
