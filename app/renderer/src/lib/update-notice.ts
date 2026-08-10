/**
 * 更新提醒已读状态管理 — 按版本号记(localStorage)。
 *
 * 三个独立已读标记(消费式红点):
 *  - dot:    侧边栏设置按钮红点(点开设置即已读)
 *  - tab:    设置弹窗「关于」标题红点(进入关于页即已读)
 *  - bubble: 设置按钮上方「重启升级」气泡(点开设置即已读)
 * 按版本号记:新版本下载完成后红点重新出现,不会被旧已读吞掉。
 */

const KEYS = {
  dot: "em-read-dot-version",
  tab: "em-read-tab-version",
  bubble: "em-read-bubble-version",
} as const;

export type UpdateNoticeKind = keyof typeof KEYS;

export function readVersion(kind: UpdateNoticeKind): string | null {
  try { return localStorage.getItem(KEYS[kind]); } catch { return null; }
}

export function markRead(kind: UpdateNoticeKind, version: string | null): void {
  try {
    if (version) localStorage.setItem(KEYS[kind], version);
    else localStorage.removeItem(KEYS[kind]);
  } catch { /* ignore */ }
}
