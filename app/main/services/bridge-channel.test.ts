import { describe, expect, it } from "vitest";
import type { Store } from "./store";
import type { RemoteTerminalService } from "./remote-terminal-service";
import { bridgeNeeded, readPolicy, syncBridge } from "./bridge-channel";

/**
 * 端口是两条通道共享的桥接（浏览器也连 47778），所以「各自控制」只能落在准入上。
 * 本文件锁住两件事：
 *  1. 端口按两个开关的**合成**结果启停（任一开就听，都关才停）；
 *  2. 每次同步都刷新准入策略，开关变化对已连接设备的去留立刻生效。
 */

function fakeStore(settings: { mobileAppEnabled?: boolean; mobileWebEnabled?: boolean }): Store {
  return { getSettings: () => settings } as unknown as Store;
}

function fakeService(running = false) {
  const state = {
    running,
    closeCalls: 0,
    policy: null as null | { allowApp: boolean; allowWeb: boolean },
  };
  const service = {
    isRunning: () => state.running,
    ensureStarted: async () => { state.running = true; },
    close: () => { state.running = false; state.closeCalls += 1; },
    setAccessPolicy: (policy: { allowApp: boolean; allowWeb: boolean }) => { state.policy = policy; },
  };
  return { service: service as unknown as RemoteTerminalService, state };
}

describe("bridge channel", () => {
  it("开关默认值：App 通道开、浏览器通道关", () => {
    expect(readPolicy({})).toEqual({ allowApp: true, allowWeb: false });
    expect(readPolicy({ mobileAppEnabled: false })).toEqual({ allowApp: false, allowWeb: false });
  });

  it("只开浏览器通道也会监听共享端口（否则浏览器无处可连）", async () => {
    const { service, state } = fakeService(false);
    await syncBridge(fakeStore({ mobileAppEnabled: false, mobileWebEnabled: true }), service);
    expect(state.running).toBe(true);
    expect(state.policy).toEqual({ allowApp: false, allowWeb: true });
  });

  it("只开 App 通道同样监听，端口不是浏览器专属", async () => {
    const { service, state } = fakeService(false);
    await syncBridge(fakeStore({ mobileAppEnabled: true, mobileWebEnabled: false }), service);
    expect(state.running).toBe(true);
    expect(state.policy).toEqual({ allowApp: true, allowWeb: false });
  });

  it("两个都关：不占端口，且真的要 close 掉正在听的监听", async () => {
    const { service, state } = fakeService(true);
    await syncBridge(fakeStore({ mobileAppEnabled: false, mobileWebEnabled: false }), service);
    expect(state.running).toBe(false);
    expect(state.closeCalls).toBe(1);
    expect(bridgeNeeded({ allowApp: false, allowWeb: false })).toBe(false);
  });

  it("端口本就在听时不重复启动，但准入仍按当前开关刷新", async () => {
    const { service, state } = fakeService(true);
    await syncBridge(fakeStore({ mobileAppEnabled: false, mobileWebEnabled: true }), service);
    expect(state.closeCalls).toBe(0);
    expect(state.policy).toEqual({ allowApp: false, allowWeb: true });
  });
});
