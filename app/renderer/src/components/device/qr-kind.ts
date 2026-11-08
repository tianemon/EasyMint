/** 面板上正在展示哪条通道的配对二维码。 */
export type QrKind = "web" | "app";

/**
 * 开关切换后该展示哪条通道的二维码。
 *
 * 规则只一条，两个开关共用：**打开哪条就看哪条**（用户刚点的就是它），
 * 关掉正看着的那条时，若另一条还开着就退过去——否则会停在「已关闭」的空码上。
 * 两条都关时停在原地，此时界面显示「已关闭」是正确的反馈，不该乱跳。
 *
 * 抽成纯函数是为了让两个开关走同一段判定：此前 App 开关只在「另一条关着」时才切、
 * 浏览器开关根本不切，于是出现「开 App 会切过去、开浏览器不会」的割裂。
 */
export function nextQrKind(
  current: QrKind,
  toggled: QrKind,
  enabled: boolean,
  otherEnabled: boolean,
): QrKind {
  if (enabled) return toggled;
  if (current === toggled && otherEnabled) return toggled === "app" ? "web" : "app";
  return current;
}
