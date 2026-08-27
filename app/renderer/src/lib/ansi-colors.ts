/**
 * ANSI 转义序列 → 带色 HTML（日志面板终端体验）。
 * 先转义 HTML 特殊字符防注入，再按 ANSI 序列逐段着色。
 * 支持：30-37/90-97 前景、40-47/100-107 背景、1 粗体、22 取消粗体、0 重置；
 * 其余序列（光标/清屏等）剥离。颜色取暗色终端主题（One Dark 系）。
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const FG: Record<number, string> = {
  30: "#565f89", 31: "#e06c75", 32: "#98c379", 33: "#e5c07b",
  34: "#61afef", 35: "#c678dd", 36: "#56b6c2", 37: "#dcdfe4",
  90: "#7f848e", 91: "#ff7b72", 92: "#7ee787", 93: "#d29922",
  94: "#58a6ff", 95: "#bc8cff", 96: "#39c5cf", 97: "#f0f6fc",
};

const BG: Record<number, string> = {
  40: "#3b3b3f", 41: "#c73e3e", 42: "#2e8b57", 43: "#c8a94b",
  44: "#3b6ea5", 45: "#8b5aa8", 46: "#3d8b6f", 47: "#c0c0c0",
  100: "#6b6f76", 101: "#a35a5a", 102: "#7f9f6f", 103: "#9f8f4f",
  104: "#5f7f9f", 105: "#8f6f9f", 106: "#5f9f8f", 107: "#a0a0a0",
};

export function ansiToHtml(text: string): string {
  let html = "";
  let fg: string | undefined;
  let bg: string | undefined;
  let bold = false;
  // 匹配全部 ANSI 序列（m 颜色 / 其他控制 / OSC / 字符集）
  const re = /\x1b\[[0-9;]*m|\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const wrap = (s: string): string => {
    const styles: string[] = [];
    if (fg) styles.push(`color:${fg}`);
    if (bg) styles.push(`background:${bg}`);
    if (bold) styles.push("font-weight:600");
    return styles.length > 0 ? `<span style="${styles.join(";")}">${s}</span>` : s;
  };
  while ((m = re.exec(text)) !== null) {
    html += wrap(escapeHtml(text.slice(last, m.index)));
    const cm = /^\x1b\[([0-9;]*)m$/.exec(m[0]);
    if (cm) {
      const codes = cm[1] ? cm[1].split(";").map(Number) : [0];
      for (const c of codes) {
        if (c === 0) { fg = undefined; bg = undefined; bold = false; }
        else if (c === 1) bold = true;
        else if (c === 22) bold = false;
        else if (c >= 30 && c <= 37) fg = FG[c];
        else if (c >= 90 && c <= 97) fg = FG[c];
        else if (c >= 40 && c <= 47) bg = BG[c];
        else if (c >= 100 && c <= 107) bg = BG[c];
      }
    }
    last = m.index + m[0].length;
  }
  html += wrap(escapeHtml(text.slice(last)));
  return html;
}
