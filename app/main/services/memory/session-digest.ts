/**
 * 会话摘要（三源降级里的最后一级）：没有开发记录、也没有仓库证据时用它。
 *
 * 只取"这一场最后在做什么"，不做技术总结：
 * - lastUser：用户最后一轮的实际要求（项目背景延续最需要的那句）
 * - lastAssistant：助手最后一轮结论的开头（用于判断是否有未完成项）
 *
 * 刻意取短：会话内容已经在原始 jsonl 里，这里只做路标，不做替代。
 */

export interface SessionMessageLike {
  role: string;
  text: string;
}

export interface SessionDigest {
  turns: number;
  lastUser?: string;
  lastAssistant?: string;
}

const LIMIT = 160;

function clip(value: string): string {
  const single = value.replace(/\s+/gu, " ").trim();
  return single.length <= LIMIT ? single : `${single.slice(0, LIMIT - 1)}…`;
}

/** 轮数按"助手给出结论的条数"计，工具与中间输出不算一轮。 */
export function digestMessages(messages: SessionMessageLike[]): SessionDigest {
  const users = messages.filter((message) => message.role === "user" && message.text.trim());
  const assistants = messages.filter((message) => message.role === "assistant" && message.text.trim());
  return {
    turns: assistants.length,
    ...(users.length ? { lastUser: clip(users.at(-1)!.text) } : {}),
    ...(assistants.length ? { lastAssistant: clip(assistants.at(-1)!.text) } : {}),
  };
}

/** 值不值得写进"项目进展"：有结论才算，纯问候不算。 */
export function worthRemembering(digest: SessionDigest, minTurns = 2): boolean {
  if (digest.turns < minTurns) return false;
  const user = digest.lastUser ?? "";
  return !/^(你好|hi|hello|在吗|嗯+|ok|好的)[!。.\s]*$/iu.test(user);
}

/** 渲染成项目进展的降级文本（与 deliverables 的措辞保持一致）。 */
export function renderSessionFallback(digest: SessionDigest): string {
  const lines: string[] = [];
  if (digest.lastUser) lines.push(`上次会话你的要求：${digest.lastUser}`);
  if (digest.lastAssistant) lines.push(`上次结论：${digest.lastAssistant}`);
  return lines.join("\n");
}
