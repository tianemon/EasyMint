import type { DisplayPresentation } from './messages';

/**
 * diff 解析 —— 与桌面端 `app/renderer/src/components/ChatBlocks.tsx:714-880` 同口径：
 *  - `diffBody`：优先用 presentation 里解出来的 diff，没有就退回正文本身
 *  - `diffStats`：只数 `+`/`-` 行，跳过 `+++`/`---` 文件头
 *  - `visibleDiffRange`：从**第一个改动 -3 行**到**最后一个改动 +3 行**的一段连续区间；
 *    区间内全量保留（hunk 之间的上下文也算），区间外才省略——桌面端用户明确要「一段连续区间」
 *    而不是按 hunk 各自裁剪、中间插省略号
 *  - `numberLines`：write 预览的行号（右对齐 4 位 + 两个空格），与桌面端补零宽度一致
 */

/** 首末改动之外各保留的上下文行数（桌面端 DIFF_CONTEXT_LINES） */
export const DIFF_CONTEXT_LINES = 3;

export function diffBody(content: string, presentation?: DisplayPresentation): string {
  return presentation?.kind === 'edit_diff' ? presentation.diff : content;
}

/** diff 文本 → 行数组。纯上下文（无 +/- 行）也原样返回，由调用方决定是否展示 */
export function diffLines(content: string, presentation?: DisplayPresentation): string[] {
  return diffBody(content, presentation).replace(/\r\n/g, '\n').split('\n');
}

export function diffStats(content: string, presentation?: DisplayPresentation): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffLines(content, presentation)) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { added, removed };
}

/** 可见区间；没有改动行时返回 null（调用方全量显示） */
export function visibleDiffRange(lines: string[]): { from: number; to: number } | null {
  const changed: number[] = [];
  lines.forEach((line, index) => {
    if (line.startsWith('+') || line.startsWith('-')) changed.push(index);
  });
  if (!changed.length) return null;
  return {
    from: Math.max(0, changed[0]! - DIFF_CONTEXT_LINES),
    to: Math.min(lines.length - 1, changed[changed.length - 1]! + DIFF_CONTEXT_LINES),
  };
}

/** write 内容预览的行号（等宽对齐，参照桌面端 numberLines） */
export function numberLines(text: string): string {
  return text.split('\n').map((line, index) => `${String(index + 1).padStart(4)}  ${line}`).join('\n');
}
