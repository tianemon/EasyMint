import { expect, it } from "vitest";
import { nextQrKind } from "./qr-kind";

/**
 * 开关与二维码页签的联动回归。
 *
 * 用户反馈：「打开 App 开关会自动切到 App 二维码，打开浏览器开关却不会」。
 * 根因是两处各写了一段判定：App 侧只在「另一条关着」时才切，浏览器侧根本不切。
 * 现在两个开关共用 nextQrKind，本文件的断言就是这条规则本身。
 */

it("打开哪条通道就展示哪条的二维码（两个开关一致）", () => {
  // 当前看 App 码，打开浏览器开关 → 切到浏览器码
  expect(nextQrKind("app", "web", true, true)).toBe("web");
  // 当前看浏览器码，打开 App 开关 → 切到 App 码
  expect(nextQrKind("web", "app", true, false)).toBe("app");
  // 两条都开着、正在看 App，再点一次浏览器开关（打开）→ 仍然切过去
  expect(nextQrKind("app", "web", true, true)).toBe("web");
});

it("关掉正看着的那条才退到另一条还开着的通道", () => {
  expect(nextQrKind("web", "web", false, true)).toBe("app");
  expect(nextQrKind("app", "app", false, true)).toBe("web");
});

it("关掉不是当前看着的通道时页签不动", () => {
  expect(nextQrKind("app", "web", false, true)).toBe("app");
  expect(nextQrKind("web", "app", false, true)).toBe("web");
});

it("两条都关时停在原地：此时显示「已关闭」是正确反馈，不乱跳", () => {
  expect(nextQrKind("web", "web", false, false)).toBe("web");
  expect(nextQrKind("app", "app", false, false)).toBe("app");
});
