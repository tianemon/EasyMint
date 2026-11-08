/**
 * 平台判定：网页端只有三件事需要按端分开——视口高度、玻璃材质、安装指引。
 *
 * 鸿蒙必须排在安卓前面：鸿蒙 2–4 是安卓底座，UA 里同时有 `Android` 和 `HarmonyOS`/`HMSCore`；
 * 鸿蒙 5（NEXT）换成 ArkWeb，UA 里是 `OpenHarmony` + `ArkWeb`，已经没有 `Android`。
 * 两种都要能被认出来，否则 NEXT 会被当成桌面端（高度用 dvh、材质按桌面走）。
 *
 * iPadOS 13 起 Safari 默认报桌面 UA（`Macintosh` + `MacIntel`），只能靠触点数区分。
 */
export type WebPlatform = 'ios' | 'android' | 'harmony' | 'desktop';

export function detectPlatform(userAgent: string, maxTouchPoints = 0): WebPlatform {
  if (/HarmonyOS|OpenHarmony|ArkWeb|HMSCore/i.test(userAgent)) return 'harmony';
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return 'desktop';
}

/** 玻璃材质口径：安卓 / 鸿蒙走整块模糊，其余（iOS、桌面浏览器）走分层折射。 */
export function usesLayeredGlass(platform: WebPlatform): boolean {
  return platform !== 'android' && platform !== 'harmony';
}

/** 安卓 / 鸿蒙共用一套布局与材质补丁（输入卡自铺底色、不用折射带）。 */
export function isMobileShell(platform: WebPlatform): boolean {
  return platform === 'android' || platform === 'harmony';
}
