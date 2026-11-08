/**
 * 会话列表右端时间与设备列表「上次 …」的文案。
 *
 * 规则对齐桌面端 SessionBar 的 archivedAt 显示：今天给 HH:MM、昨天给「昨天」、
 * 同年给「M月D日」、跨年补年份——比统一的相对时间更省心（不会出现「23 小时前」这种要心算的说法）。
 */

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 当天零点（本机时区）。用本地时间算，跨时区不会把「今天」算错一天 */
function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 会话时间：今天 16:22 / 昨天 / 11月3日 / 2025年11月3日 */
export function formatSessionTime(value: number | undefined, now = Date.now()): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const date = new Date(value);
  const today = startOfDay(now);
  if (value >= today) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (value >= today - 86_400_000) return '昨天';
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return sameYear ? monthDay : `${date.getFullYear()}年${monthDay}`;
}

/** 设备「上次在线」：刚刚 / 12 分钟前 / 3 小时前 / 昨天 / 11月3日 */
export function formatLastSeen(value: number | undefined, now = Date.now()): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const diff = now - value;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (value >= startOfDay(now)) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (value >= startOfDay(now) - 86_400_000) return '昨天';
  const date = new Date(value);
  const monthDay = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === new Date(now).getFullYear() ? monthDay : `${date.getFullYear()}年${monthDay}`;
}
