/**
 * 浏览器侧的设备名：电脑上「请求连接」弹窗里显示的那一行。
 *
 * 拿不到手机的系统设置里那个名字，也不可能拿到（浏览器沙箱）。能稳定拿到的只有
 * 平台与浏览器：iOS 的 UA 里只有 `iPhone`/`iPad`，Android 与桌面 Chromium 还有
 * `navigator.userAgentData.platform`（更干净的 `Android` / `macOS` / `Windows`）。
 * 高熵型号（`getHighEntropyValues(['model'])`）需要安全上下文，局域网 http 下拿不到，
 * 所以这里不试——显示了半截反而更误导。
 *
 * 这个名字是**给人认的**，不是身份凭证：请求体里的字符串由客户端自报，可以随便填。
 * 真正的身份是 ECDH 密钥对，以及手机上那 6 位验证码。
 */
export function deviceNameFromUserAgent(userAgent: string, platformHint?: string): string {
  const ua = userAgent || '';
  const platform = platformName(ua, platformHint);
  const browser = browserName(ua);
  if (platform && browser) return `${platform} · ${browser}`;
  return platform || browser || '浏览器';
}

function platformName(ua: string, hint?: string): string {
  // 鸿蒙必须先判：鸿蒙 2–4 的 UA 里同时有 Android 与 HarmonyOS/HMSCore（当时电脑上就会显示成安卓），
  // 鸿蒙 5 NEXT 换成 ArkWeb（OpenHarmony + ArkWeb，没有 Android 字样）。
  if (/HarmonyOS|OpenHarmony|ArkWeb|HMSCore/i.test(ua)) return '鸿蒙';
  // 先把 iPadOS 的「桌面模式」认出来：它的 UA 长成 Macintosh，但触点数 > 1
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && isIPadOS())) return 'iPad';
  if (/iPhone|iPod/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  const normalized = (hint ?? '').toLowerCase();
  if (normalized === 'macos' || /Macintosh/.test(ua)) return 'Mac';
  if (normalized === 'windows' || /Windows/.test(ua)) return 'Windows';
  if (normalized === 'chrome os' || /CrOS/.test(ua)) return 'ChromeOS';
  if (normalized === 'linux' || /Linux/.test(ua)) return 'Linux';
  return '';
}

function isIPadOS(): boolean {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
}

function browserName(ua: string): string {
  // iOS 上的第三方浏览器内核都是 WebKit，UA 里靠这些前缀区分外壳
  if (/CriOS/.test(ua)) return 'Chrome';
  if (/EdgiOS/.test(ua)) return 'Edge';
  if (/FxiOS/.test(ua)) return 'Firefox';
  // 桌面是 Edg/，Android 是 EdgA/：漏掉 A 会让安卓 Edge 显示成 Chrome
  if (/Edg(?:A)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return '';
}

/** 当前浏览器的设备名（给配对请求用）。 */
export function browserDeviceName(): string {
  const hint = typeof navigator !== 'undefined'
    ? (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform
    : undefined;
  return deviceNameFromUserAgent(typeof navigator !== 'undefined' ? navigator.userAgent : '', hint);
}
