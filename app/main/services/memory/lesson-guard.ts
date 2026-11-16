/**
 * 经验（lesson）的硬门槛。
 *
 * 设计立场：经验是"随模型变强而递减"的能力，默认不记，只在**同时满足**下面几条时留一条：
 * 1. 有明确触发条件（当/如果/遇到…）
 * 2. 有具体做法（要/先/改用/避免…）
 * 3. 有可识别的具体对象（路径、命令、错误码、版本号、反引号里的标识符）—— 纯道理不算
 * 4. 长度受限，且不是"要更小心"这类空话
 * 5. 不与已有经验重复
 *
 * 这里只做机械校验；语义判断交给分析提示词，但宁缺勿滥的门槛必须在代码里兜住。
 */

export interface LessonCandidate {
  title?: string;
  when?: string;
  do?: string;
  why?: string;
  tags?: string[];
  evidence?: string;
}

export interface LessonGuardResult {
  ok: boolean;
  reason?: string;
}

const TRIGGER = /(当|如果|一旦|遇到|碰到|出现|在.{0,12}时|before|when|if)\s*/iu;
const ACTION = /(要|应|先|改用|改为|避免|不要|别|用|换成|采用|must|should|use|avoid)/iu;
const SPECIFIC = /(`[^`]+`|\/[^\s]+\/|\.\w{1,5}\b|\b\d+(?:\.\d+)*\b|[A-Za-z][A-Za-z0-9_-]{2,})/u;
const VAGUE = /(更小心|注意一点|谨慎|多检查|仔细|多注意|be careful|pay attention)/iu;

export const LESSON_MAX_CHARS = 300;
export const LESSON_MIN_CHARS = 40;

/** 归一化后用于去重：去掉空白与标点，只留字母数字与汉字。 */
export function lessonDigest(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function guardLesson(
  candidate: LessonCandidate,
  existing: Array<{ title: string }> = [],
): LessonGuardResult {
  const title = (candidate.title ?? "").trim();
  const text = `${candidate.when ?? ""} ${candidate.do ?? ""}`.trim();
  if (!title || title.length > 40) return { ok: false, reason: "标题缺失或超过 40 字" };
  if (text.length < LESSON_MIN_CHARS) return { ok: false, reason: "内容过短，无法构成可复用条件" };
  if (`${title} ${text}`.length > LESSON_MAX_CHARS) return { ok: false, reason: "超过 300 字，不是一条经验" };
  if (!candidate.when?.trim()) return { ok: false, reason: "缺少触发条件" };
  if (!candidate.do?.trim()) return { ok: false, reason: "缺少具体做法" };
  if (!TRIGGER.test(candidate.when)) return { ok: false, reason: "触发条件没有写成「何时会这样」" };
  if (!ACTION.test(candidate.do)) return { ok: false, reason: "做法没有写成可执行的命令或步骤" };
  if (!SPECIFIC.test(`${candidate.when} ${candidate.do} ${candidate.why ?? ""}`)) return { ok: false, reason: "没有具体对象（路径/命令/版本/标识符），属于泛泛而谈" };
  if (VAGUE.test(text)) return { ok: false, reason: "属于「要更小心」类空话" };
  const digest = lessonDigest(title + text);
  for (const item of existing) {
    const other = lessonDigest(item.title);
    if (!other) continue;
    if (digest.startsWith(other) || other.startsWith(lessonDigest(title))) return { ok: false, reason: "与已有经验重复" };
  }
  return { ok: true };
}
