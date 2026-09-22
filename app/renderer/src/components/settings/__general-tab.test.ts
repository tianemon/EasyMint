/**
 * 「重新检测」的口径守卫（用户拍板：与其限制按钮出现，不如统一）。
 *
 * 背景（两个真实缺陷，2026-09-15）：
 * 1. 设置页同屏出现过两个同文案按钮，且刷新范围不同——标题栏那个只刷 Git/Node/CodeGraph，
 *    面板那个刷系统组件并重置沙盒失败缓存，用户无从分辨。
 * 2. 我一度用"面板判断 `refreshKey === undefined` 决定是否渲染自己的按钮"来消除重复，
 *    而外层传入的初值恰好也是 `undefined` → 首帧又冒出第二个按钮（哨兵值与初值撞车）。
 *
 * 现在的口径：**按钮只有一处定义（EnvRetestButton），动作只有一个（EnvPanelHandle.retest）**，
 * 面板自身永不渲染刷新按钮，"同屏两个"在结构上不可能再出现。下面把这条不变量钉住。
 */
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
const { EnvPanel, onboardingHint, nextAutoAction, workScreenVisible } = await import("../env/EnvPanel");
const { EnvRetestButton } = await import("../env/EnvRetestButton");
const { shouldPersistTavilyKey } = await import("./WebCapabilityConfig");

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe("「重新检测」全项目只有一处", () => {
  it("设置页整页渲染后按钮计数恰好为 1", () => {
    const html = renderToStaticMarkup(createElement(GeneralTab));
    expect(countOf(html, "重新检测"), "设置页出现了两个「重新检测」按钮").toBe(1);
    expect(html).toContain("环境检测"); // 确认面板/区块确实渲染了，不是"因为没有面板才只剩一个"
  });

  it("面板自身永不渲染刷新按钮（两种形态都不渲染）——这条不变量挡住整类重复", () => {
    expect(countOf(renderToStaticMarkup(createElement(EnvPanel, { variant: "settings" })), "重新检测")).toBe(0);
    expect(countOf(renderToStaticMarkup(createElement(EnvPanel, { variant: "onboarding" })), "重新检测")).toBe(0);
  });

  it("共用按钮：点下去 = 宿主自己的范围 + 面板重探（顺序固定）", () => {
    const retest = vi.fn();
    const before = vi.fn();
    const el = EnvRetestButton({
      panel: { current: { retest } },
      onBeforeRetest: before,
    }) as unknown as { props: { onClick: () => void } };

    el.props.onClick();
    expect(before).toHaveBeenCalledTimes(1);
    expect(retest).toHaveBeenCalledTimes(1);
    expect(before.mock.invocationCallOrder[0]!).toBeLessThan(retest.mock.invocationCallOrder[0]!);
  });

  it("宿主没给额外范围时（引导流程）也能单独用", () => {
    const retest = vi.fn();
    const el = EnvRetestButton({ panel: { current: { retest } } }) as unknown as { props: { onClick: () => void } };
    el.props.onClick();
    expect(retest).toHaveBeenCalledTimes(1);
  });
});

describe("引导步骤副标题：检查完就不再说「正在检查」；忙时一个字都不出", () => {
  const hint = onboardingHint;
  const base = {
    hasReport: true, probeFailed: false, requiredBroken: 0, optionalBroken: 0,
    busy: false,
  };

  it("检测/安装进行中 → 不显示任何文字（用户定：一个标题，一个动画）", () => {
    expect(hint({ ...base, busy: true, requiredBroken: 2 })).toBeNull();
  });

  it("还没拿到结论（含探测在飞与首帧）→ 也不显示文字，别先说「正在为你检查」", () => {
    expect(hint({ ...base, hasReport: false })).toBeNull();
    expect(hint({ ...base, hasReport: false, busy: true })).toBeNull();
  });

  it("过渡文案已被彻底移除：「正在为你检查」「正在自动安装」在任何状态下都不出现", () => {
    for (const s of [
      { ...base, hasReport: false }, { ...base, busy: true },
      { ...base, requiredBroken: 1 }, base,
    ]) {
      expect(hint(s) ?? "").not.toContain("正在为你检查");
      expect(hint(s) ?? "").not.toContain("正在自动安装");
    }
  });

  it("无需依赖 → 提醒检查完毕 + 继续下一步", () => {
    const t = hint(base);
    expect(t).toContain("检查完毕");
    expect(t).toContain("下一步");
  });

  it("有必装项要装 → 说清有几项必须处理", () => {
    const t = hint({ ...base, requiredBroken: 2 });
    expect(t).toContain("2 项");
    expect(t).toContain("必须处理");
  });

  it("探测失败 → 不谎报「检查完毕」（那是「检测失败」，不是「没问题」）", () => {
    const t = hint({ ...base, probeFailed: true, hasReport: false });
    expect(t).toContain("检查没能完成");
    expect(t).not.toContain("检查完毕");
  });

  it("没有任何过渡文案 —— 没问题时这一步是纯过场，跳转前不留话", () => {
    for (const s of [base, { ...base, busy: true }, { ...base, requiredBroken: 1 }, { ...base, hasReport: false }]) {
      expect(hint(s) ?? "").not.toContain("正在进入");
      expect(hint(s) ?? "").not.toContain("即将进入");
    }
  });

  it("只有可选组件缺 → 不谎报「必须处理」，说明可以继续", () => {
    const t = hint({ ...base, optionalBroken: 1 });
    expect(t).toContain("已就绪");
    expect(t).toContain("继续");
    expect(t).toContain("可选");
    expect(t).not.toContain("必须处理");
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

describe("工作屏幕（只有标题 + 动画）的可见性 —— 修掉「跳转前闪一屏依赖列表」", () => {
  const s = {
    busy: false, handedOff: false, autoFix: true, willAutoLeave: true, hasProblem: false,
  };

  it("引导流程 + 无问题 + 宿主会自己跳走 → 持续可见（**最短停留走完也仍然是**）", () => {
    // 这就是被修的缺陷：判据曾含 holdMin，它一走完工作屏幕就消失，而宿主还要 1.2s 才切步
    // → 那段时间闪出一屏依赖列表（用户报："检测没问题，还是会进入手动检测页面闪一下才跳到供应商页面"）
    expect(workScreenVisible(s)).toBe(true);
  });

  it("真在探测 / 安装 → 可见", () => {
    expect(workScreenVisible({ ...s, busy: true })).toBe(true);
  });

  it.each([false, true])("等待导入选择时结束动画，不受就绪通知先后影响（已通知：%s）", (handedOff) => {
    expect(workScreenVisible({ ...s, handedOff, waitForUser: true })).toBe(false);
    // 实际检测/安装仍需展示进度，不应被导入选项提前结束。
    expect(workScreenVisible({ ...s, handedOff, waitForUser: true, busy: true })).toBe(true);
  });

  it("pi 探测晚于环境就绪：挂起期间保持动画，命中后显示状态", () => {
    const ready = { ...s, handedOff: true };
    expect(workScreenVisible({ ...ready, waitForUser: false })).toBe(true);
    expect(workScreenVisible({ ...ready, waitForUser: true })).toBe(false);
  });

  it("有问题（检测失败 / 缺必装项）→ 才让出位置，不让人对着动画干等", () => {
    expect(workScreenVisible({ ...s, hasProblem: true })).toBe(false);
  });

  it("宿主没接管自动跳转（设置页；或用户自己「返回」再进来）→ 不可见，该显示状态与「下一步」", () => {
    expect(workScreenVisible({ ...s, willAutoLeave: false })).toBe(false);
    expect(workScreenVisible({ ...s, autoFix: false })).toBe(false);
  });

  it("已交回宿主的跳转窗口（1.2s）→ 仍可见，不留缝", () => {
    expect(workScreenVisible({
      busy: false, handedOff: true, autoFix: false, willAutoLeave: false, hasProblem: true,
    })).toBe(true);
  });
});

describe("Tavily Key 持久化判定", () => {
  it("比较最后一次落盘值，而不是输入框实时值", () => {
    expect(shouldPersistTavilyKey("tvly-new", true, "")).toBe(true);
    expect(shouldPersistTavilyKey(" tvly-saved ", true, "tvly-saved")).toBe(false);
    expect(shouldPersistTavilyKey("tvly-new", false, "")).toBe(false);
  });
});
