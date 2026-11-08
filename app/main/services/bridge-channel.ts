import type { Store } from "./store";
import type { RemoteTerminalService } from "./remote-terminal-service";

/**
 * 47778 是**共享桥接端口**，不是「手机 App 专属」：
 * App 与浏览器走的是同一条加密 WS（浏览器只是多一个 47779 的静态页入口）。
 *
 * 所以「两个开关各管各的」不能落在端口上——那样单独开浏览器就没端口可连，
 * 二维码出不来。正确的分法是：
 *  - 端口：任一通道需要就监听，两个都不需要就关闭（本文件的职责）；
 *  - 准入：App 开关决定「非 web- 设备能否连入」，浏览器开关决定「web- 设备能否连入」
 *    以及网页是否可访问（见 RemoteTerminalService.setAccessPolicy）。
 *
 * 这样两个开关互不影响，也不会出现「关掉 App 却还在替它接设备」。
 */
export type BridgePolicy = { allowApp: boolean; allowWeb: boolean };

export function readPolicy(settings: { mobileAppEnabled?: boolean; mobileWebEnabled?: boolean }): BridgePolicy {
  return {
    // 默认开：老用户机器上已有配对设备，默认关掉会表现为「手机突然连不上」
    allowApp: settings.mobileAppEnabled !== false,
    // 默认关：网页入口需要用户显式开启
    allowWeb: settings.mobileWebEnabled ?? false,
  };
}

export function bridgeNeeded(policy: BridgePolicy): boolean {
  return policy.allowApp || policy.allowWeb;
}

/**
 * 按当前两个开关对齐「端口是否监听」与「设备准入」。
 * 幂等：反复调用只会在状态真的需要变化时动端口。
 */
export async function syncBridge(store: Store, service: RemoteTerminalService): Promise<void> {
  const policy = readPolicy(store.getSettings());
  // 准入先落：即使端口已在听，开关变化也要立刻影响新连接与已连接设备的去留
  service.setAccessPolicy(policy);
  if (bridgeNeeded(policy)) {
    await service.ensureStarted();
    return;
  }
  if (service.isRunning()) service.close();
}
