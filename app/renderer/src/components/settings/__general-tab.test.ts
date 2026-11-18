/** Settings keep one recheck entry while first-run handles the handoff separately. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// GeneralTab 的 CodegraphRow 在**渲染期**就读 window.electronAPI.platform（node 环境没有 window）
globalThis.window = { electronAPI: { platform: "darwin" } } as never;

// 只 mock 这两个：settings-store（否则要把 zustand 与 @shared 别名一起拖进来）与确认弹窗
vi.mock("../../stores/settings-store", () => {
  const state = {
    sandboxDisabled: false,
    setSandboxDisabled: (): void => { /* 测试不触发 */ },
    defaultProjectDir: "~/EasyMintProject",
    contextThreshold: 75,
    setDefaultProjectDir: (): void => { /* 测试不触发 */ },
    setContextThreshold: (): void => { /* 测试不触发 */ },
  };
  return { useSettingsStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock("../ui/ConfirmDialog", () => ({ confirmDialog: async (): Promise<boolean> => true }));

const { GeneralTab } = await import("./GeneralTab");
const { EnvPanel, nextAutoAction } = await import("../env/EnvPanel");
const { shouldPersistTavilyKey } = await import("./WebCapabilityConfig");

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe("环境检测入口", () => {
  it("通用设置只提供一个重新检测按钮", () => {
    const html = renderToStaticMarkup(createElement(GeneralTab, {}));
    expect(countOf(html, "重新检测")).toBe(1);
    expect(html).toContain("环境检测");
  });

  it("首次启动只提供检查过场，无重复的重新检测入口", () => {
    const html = renderToStaticMarkup(createElement(EnvPanel, { variant: "onboarding" }));
    expect(html).toContain("准备运行环境");
    expect(countOf(html, "重新检测")).toBe(0);
  });
});

describe("进入环境检测页即自动安装（决策纯函数）", () => {
  const s = {
    autoFix: true, hasReport: true, probeFailed: false, probing: false, installing: false,
    sandboxDisabled: false, installableCount: 0, fixableCount: 0, done: new Set<"pkg" | "userns">(),
  };

  it("探测完且有可自动安装项 → 自动装（无需点击）", () => {
    expect(nextAutoAction({ ...s, installableCount: 3 })).toBe("pkg");
    expect(nextAutoAction({ ...s, fixableCount: 1 })).toBe("userns");
  });

  it("没探测完 / 探测在飞 / 正在装 / 未开启自动 → 不动", () => {
    expect(nextAutoAction({ ...s, installableCount: 2, hasReport: false })).toBeNull();
    expect(nextAutoAction({ ...s, installableCount: 2, probing: true })).toBeNull();
    expect(nextAutoAction({ ...s, installableCount: 2, installing: true })).toBeNull();
    expect(nextAutoAction({ ...s, installableCount: 2, autoFix: false })).toBeNull();
  });

  it("探测失败（报告是上一轮旧数据）→ 不按它动手，先让用户重测", () => {
    expect(nextAutoAction({ ...s, installableCount: 2, probeFailed: true })).toBeNull();
  });

  it("用户已选择「关闭沙盒运行」→ 不替他弹系统授权框（按钮仍可手点）", () => {
    expect(nextAutoAction({ ...s, installableCount: 2, sandboxDisabled: true })).toBeNull();
    expect(nextAutoAction({ ...s, fixableCount: 1, sandboxDisabled: true })).toBeNull();
  });

  it("同一种动作**只自动跑一次** —— 用户拒绝授权框/装失败后不再自动弹，改由用户点", () => {
    expect(nextAutoAction({ ...s, installableCount: 2, done: new Set(["pkg"]) })).toBeNull();
    expect(nextAutoAction({ ...s, fixableCount: 1, done: new Set(["userns"]) })).toBeNull();
  });

  it("平台没有自动安装通道（只能手工）→ 不给自动动作，界面留自助命令", () => {
    expect(nextAutoAction({ ...s, installableCount: 0, fixableCount: 0 })).toBeNull();
  });

  it("先装包、装完仍被策略挡时才轮到 userns 自动修复（不会同一轮抢跑）", () => {
    expect(nextAutoAction({ ...s, installableCount: 1, fixableCount: 1 })).toBe("pkg");
    expect(nextAutoAction({ ...s, installableCount: 0, fixableCount: 1 })).toBe("userns");
  });
});

describe("Tavily Key 持久化判定", () => {
  it("比较最后一次落盘值，而不是输入框实时值", () => {
    expect(shouldPersistTavilyKey("tvly-new", true, "")).toBe(true);
    expect(shouldPersistTavilyKey(" tvly-saved ", true, "tvly-saved")).toBe(false);
    expect(shouldPersistTavilyKey("tvly-new", false, "")).toBe(false);
  });
});
