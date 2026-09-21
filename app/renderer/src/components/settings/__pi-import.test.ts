/**
 * pi 配置导入入口（2026-09-21 布点重构）的口径守卫。
 *
 * 背景：入口从「供应商设置页顶部」改为「引导页 Step 2 自动探测 + 设置页·通用页手动触发」。
 * Step 2 的「就绪即自动离开」时序是历史敏感区——自动跳过去等于把导入入口收走，
 * 询问形同虚设。这里钉住三条不变量：
 * 1. 门控纯函数：命中且未导入不放行；未命中 / 已导入放行（用户拍板：跳过不锁定）
 * 2. 确认弹窗逐项列出会导入的内容（需求原话「说明会导入的项」）
 * 3. 流程调用序列：预览 → 确认 → apply；未找到 / 用户取消时**绝不下发 apply**（绝不写盘）
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiImportSummary } from "@shared/pi-config-import";

// 只 mock 这三个：设置 store（否则要把 zustand 与 @shared 别名一起拖进来）、确认弹窗、toast
vi.mock("../../stores/settings-store", () => {
  const state = { loadFromElectron: vi.fn(async () => {}) };
  return { useSettingsStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock("../ui/ConfirmDialog", () => ({ confirmDialog: vi.fn(async (): Promise<boolean> => true) }));
vi.mock("../ui/Toast", () => ({ toast: vi.fn() }));

const { PiImportCard, PiImportSection, envAutoAdvanceAllowed, piImportConfirmMessage, runPiImportFlow } =
  await import("./PiImport");
const { confirmDialog } = await import("../ui/ConfirmDialog");
const { toast } = await import("../ui/Toast");
const { useSettingsStore } = await import("../../stores/settings-store");
const loadMock = vi.mocked(useSettingsStore.getState().loadFromElectron);

// window.electronAPI：流程函数只在调用期读它（渲染期不碰），测试里给一份可断言的 mock
type PiImportInput = { sourceDir?: string; apply?: boolean; probe?: boolean };
const piImportCalls: PiImportInput[] = [];
const preview: PiImportSummary = {
  sourceDir: "/home/u/.pi/agent", found: true, providers: 2, sessions: 5, projects: 1,
  conflicts: 0, duplicates: 0, invalidSessions: 0, providerConflictSessions: 0,
  oauth: false, skippedSettings: [],
};
const applied: PiImportSummary = { ...preview };
const piImportMock = vi.fn(async (input: PiImportInput = {}): Promise<PiImportSummary> => {
  piImportCalls.push(input);
  return input.apply ? applied : preview;
});
globalThis.window = {
  electronAPI: {
    settings: {
      piImport: piImportMock,
      get: vi.fn(async () => ({ nativeConfigMigration: { duplicateConfigIds: [] } })),
    },
    dialog: { openDirectory: vi.fn(async () => undefined) },
  },
} as never;

const plan = (over: Partial<PiImportSummary>): PiImportSummary => ({ ...preview, ...over });

beforeEach(() => {
  piImportCalls.length = 0;
  piImportMock.mockClear();
  vi.mocked(confirmDialog).mockClear();
  vi.mocked(confirmDialog).mockResolvedValue(true);
  vi.mocked(toast).mockClear();
  loadMock.mockClear();
});

describe("Step 2 自动跳转门控（envAutoAdvanceAllowed）", () => {
  it("pi 检测未落定 → 不放行（先记账，等探测落定后重放）", () => {
    expect(envAutoAdvanceAllowed("pending", false)).toBe(false);
  });

  it("命中且未导入 → 不放行：跳过只由「下一步」或导入完成触发（不锁定）", () => {
    expect(envAutoAdvanceAllowed("hit", false)).toBe(false);
  });

  it("命中且已导入 → 放行（导入完成即进 Step 3 展示导入的供应商）", () => {
    expect(envAutoAdvanceAllowed("hit", true)).toBe(true);
  });

  it("未命中 → 放行：Step 2 保持纯过场原行为（大多数用户无感知）", () => {
    expect(envAutoAdvanceAllowed("miss", false)).toBe(true);
  });
});

describe("确认弹窗逐项说明（piImportConfirmMessage）", () => {
  it("列出供应商 / 会话 / 项目记录数量，与「EM 已有配置优先」的口径", () => {
    const text = piImportConfirmMessage(plan({}));
    expect(text).toContain("供应商 2 个");
    expect(text).toContain("会话 5 个");
    expect(text).toContain("项目记录 1 个");
    expect(text).toContain("EM 已有配置优先");
    expect(text).not.toContain("跳过");
    expect(text).not.toContain("OAuth");
  });

  it("有跳过项才列跳过明细；OAuth 只在有 OAuth 凭据时提示重新登录风险", () => {
    const text = piImportConfirmMessage(plan({ conflicts: 2, duplicates: 3, invalidSessions: 1, oauth: true }));
    expect(text).toContain("跳过：2 项冲突、3 个重复会话、1 个无效会话");
    expect(text).toContain("OAuth 账号复制后两份令牌独立，后续可能需要重新登录");
  });
});

describe("runPiImportFlow 调用序列", () => {
  it("未找到 → 返回 null、toast 提示；不下发确认与 apply（绝不写盘）", async () => {
    piImportMock.mockResolvedValueOnce(plan({ found: false }));
    const r = await runPiImportFlow();
    expect(r).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("未找到"));
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(piImportCalls.filter((c) => c.apply)).toHaveLength(0);
  });

  it("用户取消 → 止步于预览，不下发 apply、不刷新 store", async () => {
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    const r = await runPiImportFlow("/custom/pi");
    expect(r).toBeNull();
    expect(piImportCalls).toEqual([{ sourceDir: "/custom/pi" }]);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("确认导入 → 预览 → apply(plan.sourceDir) → 刷新 store → 返回导入结果", async () => {
    const r = await runPiImportFlow();
    expect(r).toBe(applied);
    expect(confirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: "检测到 pi 配置", confirmText: "导入" }));
    expect(piImportCalls[0]).toEqual({ sourceDir: undefined });
    expect(piImportCalls[1]).toEqual({ sourceDir: preview.sourceDir, apply: true });
    expect(loadMock).toHaveBeenCalledTimes(1);
  });
});

describe("两个宿主的静态渲染", () => {
  it("引导页卡片：含检测结论、「导入 pi 配置」按钮与跳过指引（命中才由宿主渲染）", () => {
    const html = renderToStaticMarkup(createElement(PiImportCard, { onImported: () => {} }));
    expect(html).toContain("检测到本机 pi 配置");
    expect(html).toContain("导入 pi 配置");
    expect(html).toContain("下一步");
  });

  it("设置页小节：标题 + 手动「检测」按钮 + 说明（手动触发，不随挂载自动弹窗）", () => {
    const html = renderToStaticMarkup(createElement(PiImportSection));
    expect(html).toContain("原生 pi 配置");
    expect(html).toContain("一次性复制");
    expect(html).toContain(">检测<");
  });
});
