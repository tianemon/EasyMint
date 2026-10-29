/**
 * 命令输出里的「需要人操作」信号识别 —— 后台命令跑起来后才出现的授权链接/交互提示，
 * 不再依赖 Mint 事先猜中执行方式，也不依赖它把链接抄进正文。
 *
 * 为什么只能在输出流上做：npm 登录链接出现在运行第 3 秒、且**事先不可预判**
 * （2026-10-29 实测：模型选了后台 → 链接进了日志面板，用户完全没看见）。
 * 这类信号是可枚举的，识别必须是确定性的系统行为。
 *
 * 边界（按 2026-10-29 收缩后的计划）：
 * - 只认「明确的交互提示」与「伴随授权语义的链接」，普通 URL 一律不认。
 * - 命中只是**候选**：link 类可能误判（文档里的登录链接），文案必须写「可能需要你操作」。
 * - 识别在**原始输出**上做（脱敏前）：链接本身要能点开，打码就失效；但原始文本不会
 *   原样进模型上下文 —— 注入会话的只有 URL + 一行说明。
 * - 不推断「已完成」：点开链接 ≠ 授权成功，状态只看进程是否还在跑。
 */

import { stripAnsi } from "./encoding";

export type HumanActionKind = "link" | "prompt";
/** explicit = 明确在等人（按键/验证码提示）；possible = 疑似（授权语义链接） */
export type HumanActionConfidence = "explicit" | "possible";

export interface HumanAction {
  kind: HumanActionKind;
  confidence: HumanActionConfidence;
  /** 去重键（同一进程内相同键只发一次；不同 URL 各自独立 → 两次授权分别展示） */
  key: string;
  /** 授权链接（kind=link） */
  url?: string;
  /** 命中处的单行原文（已剥 ANSI、压缩空白、截断） */
  hint: string;
}

/** 尾部保留长度：提示可能跨 chunk 被切断，留足一整行上下文 */
const TAIL_CHARS = 4096;
/** 单进程最多抛多少条 link 候选（防文档刷屏；prompt 类靠去重键天然收敛） */
const MAX_LINK_ACTIONS = 3;
/** 注入会话的 hint 上限 */
const MAX_HINT = 200;

/** 明确的「在等人」提示：命中即 explicit（这些词几乎不会出现在普通输出里） */
const PROMPT_PATTERNS: RegExp[] = [
  /\bpress\s+(?:enter|return|any\s+key|space)\b/i,
  /\benter\s+(?:the\s+)?(?:code|verification\s+code|one[-\s]?time\s+code|otp|password|passphrase)\b/i,
  /\b(?:verification|one[-\s]?time|device|login)\s+code\s*[:：]/i,
  /\bpassword\s*[:：]\s*$/i,
  /\[\s*[yYnN]\s*\/\s*[yYnN]\s*\]/,
  /\(\s*[yY]\s*\/\s*[nN]\s*\)/,
  /\bcontinue\?\s*$/i,
  /\bwaiting\s+for\s+(?:your\s+)?(?:input|confirmation|authorization|approval)\b/i,
  /\bto\s+(?:continue|proceed),?\s+(?:please\s+)?(?:press|open|visit|enter|click)\b/i,
  // 验证码型 2FA：npm 的 EOTP 分支只打印提示、不给链接（`provide ... by passing --otp=<code>`），
  // 只认链接会让这类"在等人"完全静默。
  /\b(?:requires?\s+(?:an?\s+)?one[-\s]?time\s+password|--otp\b|<otp>|otp\s*[:=]\s*<)/i,
];

/** 授权语义词：出现在链接所在行（或链接自身）时，才把 URL 当候选 */
const AUTH_WORDS_RE =
  /\b(log\s?in|sign\s?in|signin|authoriz(?:e|ation)|authenticat(?:e|ion)|device\s+code|verif(?:y|ication)|one[-\s]?time|otp|activate|access\s+token|confirm\s+your)\b/i;

/** 强授权语义（URL 自身携带时基本可断定是授权/确认入口） */
const STRONG_URL_RE = /\b(oauth|authoriz|device|verif|activate|one[-_]?time|otp)\b/i;
/** 弱授权语义（登录页；需要旁证才当成真等待，否则只是"文档里的登录链接"） */
const WEAK_URL_RE = /(login|signin|sign[_-]?in)/i;
/** 同行出现这些词，说明是在**指示**用户去打开它 */
const INSTRUCTION_RE = /\b(visit|open|browser|please|click|go\s+to|approve|confirm)\b/i;

const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/g;
/** URL 尾部的句点/逗号/分号是句子标点，不属于链接 */
const URL_TRAILING = /[.,;:!?]+$/;

/** 归一化去重键文本：小写、压缩空白、数字折叠（`Enter code: 123456` 与 `: 654321` 视为同一条） */
function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

/** 命中的单行原文：剥 ANSI、取该 URL/提示所在行、压缩空白、截断 */
function lineOf(rawLine: string): string {
  const s = rawLine.replace(/\s+/g, " ").trim();
  return s.length > MAX_HINT ? `${s.slice(0, MAX_HINT)}…` : s;
}

/**
 * 逐进程的识别器：喂解码后的原始输出片段，返回**本次新增**的人工操作候选。
 *
 * 做法是「保留尾部窗口 + 每次整体重扫 + 按键去重」，不用游标：
 * 提示常被 chunk 切断（`Press EN` | `TER`），游标会漏；而重扫 4KB 的代价可以忽略，
 * 重复命中天然被 key 挡掉。
 */
export class HumanActionDetector {
  private tail = "";
  private seen = new Set<string>();
  private linkCount = 0;
  private readonly maxLinks: number;

  constructor(maxLinks: number = MAX_LINK_ACTIONS) {
    this.maxLinks = maxLinks;
  }

  feed(chunk: string): HumanAction[] {
    if (!chunk) return [];
    // ANSI 会插在提示词中间（`\x1b[1mPress ENTER\x1b[0m`），匹配前必须剥掉
    this.tail = stripAnsi(this.tail + chunk);
    if (this.tail.length > TAIL_CHARS) this.tail = this.tail.slice(-TAIL_CHARS);

    const found: HumanAction[] = [];
    const lines = this.tail.split(/\r\n|\r|\n/);
    for (const rawLine of lines) {
      if (!rawLine.trim()) continue;
      // 一行只出一条：同一行先算链接，**有链接就不另发提示**。
      // `Press ENTER to open https://…/login` 正是常见形态——以前命中提示就 continue，
      // 链接被吞掉，用户拿不到可点的东西（实测复现）。反过来只留提示也没意义：
      // 提示原文已经写进 link.action 的 hint。
      let emitted = false;
      for (const action of this.matchLinks(rawLine)) {
        if (this.linkCount >= this.maxLinks) break;
        if (this.seen.has(action.key)) continue;
        this.seen.add(action.key);
        this.linkCount += 1;
        found.push(action);
        emitted = true;
      }
      if (emitted) continue;
      const prompt = this.matchPrompt(rawLine);
      if (prompt && !this.seen.has(prompt.key)) {
        this.seen.add(prompt.key);
        found.push(prompt);
      }
    }
    return found;
  }

  private matchPrompt(line: string): HumanAction | undefined {
    for (const re of PROMPT_PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      // 只取到命中片段为止的原文：`Enter code: 123456` 这种行会把**用户输入的验证码**
      // 一起带进会话（进而进模型上下文与落盘历史）。计划要求不回显输入内容，
      // 而终端程序的提示行恰恰可能回显刚收到的码。命中之后若还有长数字串，直接截断；
      // 没有数字（`Press ENTER to continue`）则保留整行，可读性不受影响。
      const hitEnd = (m.index ?? 0) + m[0].length;
      const rest = line.slice(hitEnd);
      const hint = lineOf(/\d{4,}/.test(rest) ? line.slice(0, hitEnd) : line);
      return {
        kind: "prompt",
        confidence: "explicit",
        // 键取命中片段而非整行：npm 进度行会带变化的前缀，整行会让去重失效
        key: `prompt:${normalizeKey(m[0])}`,
        hint,
      };
    }
    return undefined;
  }

  private matchLinks(line: string): HumanAction[] {
    const out: HumanAction[] = [];
    for (const m of line.matchAll(URL_RE)) {
      const url = m[0].replace(URL_TRAILING, "");
      if (!url) continue;
      // 判据只认 **URL 自身** 的授权语义：`npm notice Log in on https://registry.npmjs.org/`
      // 那种"同行说了 login、链接却是仓库地址"的写法必须排除（实测会误报成授权入口）。
      const strong = STRONG_URL_RE.test(url);
      if (!strong && !WEAK_URL_RE.test(url)) continue;
      const around = line.replace(m[0], " ");
      // explicit 需要旁证：强词 + 授权说明，或登录页 + 明确的"去打开"指示
      const explicit = strong
        ? AUTH_WORDS_RE.test(around) || INSTRUCTION_RE.test(around)
        : INSTRUCTION_RE.test(around);
      out.push({
        kind: "link",
        confidence: explicit ? "explicit" : "possible",
        key: `link:${url}`,
        url,
        hint: lineOf(line),
      });
    }
    return out;
  }
}

/** 纯函数入口（测试/一次性扫描用）：一次性扫完整段输出 */
export function detectHumanActions(text: string): HumanAction[] {
  return new HumanActionDetector().feed(text);
}
