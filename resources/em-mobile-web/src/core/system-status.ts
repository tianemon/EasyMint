/**
 * 结果型系统消息的分类、状态词与着色口径。
 *
 * 与桌面端 `app/renderer/src/components/ChatPanel.tsx:3365-3380` 同源：
 *  - isResult = delegation / shell / human-action（human-action 是 2026-10-30 新增的命令交互提示）
 *  - 「Every system type is collapsed」：所有系统 kind 默认折叠，展开看完整内容
 *  - 状态词决定标题栏颜色：失败=红，中止/等待系=琥珀，完成=绿
 *
 * 抽成不依赖 react-native 的纯模块，是为了让 `node:test` 能直接验证这些清单
 * （SystemCard.tsx 一 import 就会拉进 RN 运行时）。
 */
export const RESULT_KINDS = new Set(['delegation', 'shell', 'human-action']);

/** 手机端自有的两类不折叠：error 是运行错误卡、system 是丢弃插话等即时提示，收起来会漏看。 */
export const ALWAYS_EXPANDED_KINDS = new Set(['error', 'system']);

export const RESULT_STATUS_WORDS = [
  '完成', '失败', '中止', '已由用户中断', '已由用户中止', '已中止', '已随权限切换中止', '等待你操作',
];

/** 人为主动停止 / 等待人工操作的状态词（琥珀色），与桌面端 ChatPanel.tsx:3377 同表。 */
export const STOPPED_STATUSES = new Set([
  '中止', '已由用户中断', '已由用户中止', '已中止', '已随权限切换中止', '等待你操作',
]);

/** ⏺ 名称 - 状态 · 时长（分隔符兼容新旧：连字符与破折号）。 */
export const RESULT_ROW_RE = new RegExp(`^⏺ (.+?) [-—] (${RESULT_STATUS_WORDS.join('|')})(?: · (\\d+)s)?$`);

export function statusTone(value: string | undefined): 'failed' | 'interrupt' | 'done' {
  if (value === '失败') return 'failed';
  return value && STOPPED_STATUSES.has(value) ? 'interrupt' : 'done';
}

/**
 * 「等待你操作」卡片里的授权链接，与桌面端 `ChatPanel.tsx:3460-3470` 同款：
 * 只认这两种行、只允许 http/https —— 不把卡片里所有 URL 都变成链接
 * （与桌面端 markdown.ts 的 safeHref 白名单共用一条外链通道）。
 * 桌面端点开走系统浏览器；手机端用 Linking.openURL，见 SystemCard。
 */
export const AUTH_LINK_RE = /^(授权链接|可能相关的链接):\s*(https?:\/\/\S+)$/;

export function authLinkFromRow(row: string): { label: string; url: string } | null {
  const match = AUTH_LINK_RE.exec(row.trim());
  return match ? { label: match[1], url: match[2] } : null;
}
