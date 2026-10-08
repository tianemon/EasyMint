import { uiI18n, uiText } from "./i18n";

export function formatDate(value: number | Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(uiI18n.resolvedLanguage, options).format(value);
}

export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(uiI18n.resolvedLanguage, options).format(value);
}

export function relativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(uiI18n.resolvedLanguage, { numeric: "auto" }).format(value, unit);
}

export function formatRelativeTimestamp(timestamp: number, now = Date.now()): string {
  const elapsed = now - timestamp;
  if (elapsed < 60_000) return uiText("ui.DevicePanel.justNow");
  if (elapsed < 3_600_000) return relativeTime(-Math.floor(elapsed / 60_000), "minute");
  if (elapsed < 86_400_000) return relativeTime(-Math.floor(elapsed / 3_600_000), "hour");
  return relativeTime(-Math.floor(elapsed / 86_400_000), "day");
}
