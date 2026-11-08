/**
 * ANSI 转义序列 → 着色段落（终端日志体验）。
 *
 * **与桌面端 `app/renderer/src/lib/ansi-colors.ts` 逐项同源**：同一组颜色表（One Dark 系）、
 * 同一批支持的控制码（30-37/90-97 前景、40-47/100-107 背景、1 粗体、22 取消粗体、0 重置），
 * 其余序列（光标/清屏/OSC/字符集）一律剥离。PC 那边转 HTML 字符串，这里转 RN 的段落数组。
 */

export type AnsiSegment = {
  text: string;
  color?: string;
  background?: string;
  bold?: boolean;
};

/** 前景色：30-37 标准色 + 90-97 亮色（值抄自 PC，勿自行调色） */
const FG: Record<number, string> = {
  30: '#565f89', 31: '#e06c75', 32: '#98c379', 33: '#e5c07b',
  34: '#61afef', 35: '#c678dd', 36: '#56b6c2', 37: '#dcdfe4',
  90: '#7f848e', 91: '#ff7b72', 92: '#7ee787', 93: '#d29922',
  94: '#58a6ff', 95: '#bc8cff', 96: '#39c5cf', 97: '#f0f6fc',
};

/** 背景色：40-47 / 100-107 */
const BG: Record<number, string> = {
  40: '#3b3b3f', 41: '#c73e3e', 42: '#2e8b57', 43: '#c8a94b',
  44: '#3b6ea5', 45: '#8b5aa8', 46: '#3d8b6f', 47: '#c0c0c0',
  100: '#6b6f76', 101: '#a35a5a', 102: '#7f9f6f', 103: '#9f8f4f',
  104: '#5f7f9f', 105: '#8f6f9f', 106: '#5f9f8f', 107: '#a0a0a0',
};

/** 全部 ANSI 序列（m 颜色 / 其他控制 / OSC / 字符集）——与 PC 同一条正则 */
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]/g;

/** 把带 ANSI 的文本切成着色段；非颜色序列被剥离，纯文本段也能正确拼接 */
export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let color: string | undefined;
  let background: string | undefined;
  let bold = false;
  let last = 0;
  let match: RegExpExecArray | null;

  const push = (value: string): void => {
    if (!value) return;
    segments.push(color || background || bold ? { text: value, color, background, bold } : { text: value });
  };

  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(text)) !== null) {
    push(text.slice(last, match.index));
    const colorMatch = /^\x1b\[([0-9;]*)m$/.exec(match[0]);
    if (colorMatch) {
      const codes = colorMatch[1] ? colorMatch[1].split(';').map(Number) : [0];
      for (const code of codes) {
        if (code === 0) { color = undefined; background = undefined; bold = false; }
        else if (code === 1) bold = true;
        else if (code === 22) bold = false;
        else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) color = FG[code];
        else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) background = BG[code];
      }
    }
    last = match.index + match[0].length;
  }
  push(text.slice(last));
  return segments;
}
