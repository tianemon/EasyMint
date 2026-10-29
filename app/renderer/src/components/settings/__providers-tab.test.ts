/**
 * 「联网能力」只有一个 Key 字段、没有任何开关 —— 两处（引导页 / 设置页）同源。
 *
 * 背景（用户 2026-09-15 两次拍板）：
 * 1. 搜索与抓取用的是**同一个 Tavily Key**，但设置页曾拆成两行、每行一个同 keyId 的输入框 ——
 *    写的是同一处存储，用户不知道该填哪个。
 * 2. 随后取消开关：**填写 key 即启用、清空即停用**。此前"开关 on + key 非空"两个条件会造出
 *    "填了 key 却没开开关"的静默失效 —— 界面上看不出差别，模型那边工具就是不出现。
 *
 * 只断言静态结构，不跑 effect（node 环境，无 jsdom）：设置值由 effect 异步加载，本测试不依赖它。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApiProvidersData, ProviderConfig } from "@shared/platform-presets";

globalThis.window = {
  electronAPI: { platform: "darwin", settings: { get: async () => ({}), set: async () => {} } },
} as never;

vi.mock("../../stores/settings-store", () => {
  const state = {
    defaultProjectDir: "~/EasyMintProject",
    contextThreshold: 75,
    setDefaultProjectDir: (): void => { /* 测试不触发 */ },
    setContextThreshold: (): void => { /* 测试不触发 */ },
  };
  return { useSettingsStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock("../ui/ConfirmDialog", () => ({ confirmDialog: async (): Promise<boolean> => true }));

const { ProvidersTab } = await import("./ProvidersTab");
const { TavilyKeySection } = await import("./TavilyKeySection");
const { isDuplicateProvider, saveProviderConfig } = await import("./ProviderSettings");

const countOf = (html: string, needle: string): number => html.split(needle).length - 1;

describe("联网能力：一个 Key、没有开关", () => {
  it("设置页：Tavily Key 字段恰好 1 个，且没有任何能力开关", () => {
    const html = renderToStaticMarkup(createElement(ProvidersTab));
    expect(countOf(html, "Tavily API Key"), "同一个 Tavily Key 出现了多个输入框——搜索与抓取应共用一个字段").toBe(1);
    expect(countOf(html, 'role="switch"'), "不该再有能力开关：填写 key 即启用").toBe(0);
    // 图片识别同样是「填 key 即启用」，它的 key 字段照常在
    expect(countOf(html, "VISION_API_KEY")).toBe(1);
  });

  it("引导页：同一份字段（一个 Key、无开关）", () => {
    const html = renderToStaticMarkup(createElement(TavilyKeySection));
    expect(countOf(html, "Tavily API Key")).toBe(1);
    expect(countOf(html, 'role="switch"')).toBe(0);
  });
});

/**
 * 「添加供应商」的重复判定。
 *
 * 用户实测（2026-10-25）：配 OpenAI Codex 时账号登录一成功，主进程的投影就把该供应商补进了
 * configs（凭据已在 auth.json），于是点「保存供应商」直接报「该供应商已存在」——
 * 只能关掉设置、重开、改成「编辑」才存得进去。判据必须落在「用户保存过」这件事上。
 */
describe("添加供应商：登录只落凭据不算「已存在」", () => {
  it("没有偏好记录、也没有连接信息（登录刚写凭据）→ 不拦，按新建走", () => {
    expect(isDuplicateProvider(undefined)).toBe(false);
    expect(isDuplicateProvider({ id: "openai-codex", createdAt: 0 } as never)).toBe(false);
  });

  it("用户真正保存过（createdAt > 0）→ 仍要拦下并提示去编辑", () => {
    expect(isDuplicateProvider({ id: "openai-codex", createdAt: 1789468025453 } as never)).toBe(true);
  });

  /**
   * 从 pi 配置导入的供应商只写 models.json、**不写偏好记录**，createdAt 同样是 0。
   * 放行会走 add 形态的 upsert，而 saveProviders 对 baseUrl/apiType/models 的回写是
   * 「表单里为空则删除」→ 把导入来的自定义端点/自添加模型抹掉。这类条目必须仍拦下。
   */
  it("createdAt 0 但带连接信息或自添加模型（导入的供应商）→ 也要拦，别覆盖掉原配置", () => {
    expect(isDuplicateProvider({ id: "custom-1", createdAt: 0, baseUrl: "https://gw.example.com/v1" } as never)).toBe(true);
    expect(isDuplicateProvider({ id: "custom-1", createdAt: 0, apiType: "openai-completions" } as never)).toBe(true);
    expect(isDuplicateProvider({ id: "deepseek", createdAt: 0, extraModels: ["deepseek-x"] } as never)).toBe(true);
  });
});

/**
 * 真正跑在「点了保存之后」的分支。之前的用例只测判断函数本身，
 * 这条把它连到 saveProviderConfig（组件里 handleSave 走的就是它）。
 */
describe("saveProviderConfig：存不存、怎么存", () => {
  /** 主进程视角的配置快照；条目只写本用例关心的字段，故用 as 断言到真实类型 */
  type Saved = ApiProvidersData;

  const codexAfterLogin = { id: "openai-codex", name: "我的Codex", createdAt: 0 } as unknown as ProviderConfig;
  /** 登录刚写凭据、主进程投影出来的那条 + 一个已配置好的 deepseek */
  const savedWithLoginOnly = {
    revision: "r1",
    current: "deepseek",
    configs: {
      deepseek: { id: "deepseek", createdAt: 111, apiKey: "sk-x" },
      "openai-codex": { id: "openai-codex", createdAt: 0 },
    },
  } as unknown as Saved;
  const savedAfterUserSave = {
    revision: "r1",
    current: "deepseek",
    configs: { "openai-codex": { id: "openai-codex", createdAt: 5 } },
  } as unknown as Saved;

  const deps = (saved: Saved | undefined, ok = true) => {
    const persisted: unknown[] = [];
    return {
      persisted,
      deps: {
        readSaved: async () => saved,
        persist: async (data: unknown) => { persisted.push(data); return ok; },
      },
    };
  };

  it("add + 登录投影出来的条目 → 放行成 upsert，并保留其他供应商", async () => {
    const { deps: d, persisted } = deps(savedWithLoginOnly);
    await expect(saveProviderConfig("add", codexAfterLogin, d)).resolves.toBe(true);
    expect(persisted).toHaveLength(1);
    const data = persisted[0] as { configs: Record<string, unknown>; current: string };
    expect(Object.keys(data.configs)).toEqual(["deepseek", "openai-codex"]);
    expect(data.configs["openai-codex"]).toMatchObject({ name: "我的Codex" });
    expect(data.current).toBe("deepseek"); // 已选中的供应商不被新增的顶掉
  });

  it("add + 用户保存过（createdAt>0）→ 抛「已存在」，一个字节都不写", async () => {
    const { deps: d, persisted } = deps(savedAfterUserSave);
    await expect(saveProviderConfig("add", codexAfterLogin, d)).rejects.toThrow("该供应商已存在");
    expect(persisted).toHaveLength(0);
  });

  it("edit → 不再判重（编辑已有条目本来就是覆盖自己）", async () => {
    const { deps: d, persisted } = deps(savedAfterUserSave);
    await expect(saveProviderConfig("edit", { ...codexAfterLogin, createdAt: 5 }, d)).resolves.toBe(true);
    expect(persisted).toHaveLength(1);
  });

  it("没有已保存配置时新建（首装）→ 直接落盘并成为默认供应商", async () => {
    const { deps: d, persisted } = deps(undefined);
    await saveProviderConfig("add", codexAfterLogin, d);
    expect((persisted[0] as { current: string }).current).toBe("openai-codex");
  });

  it("落盘失败 → 原样返回 false（调用方据此不关弹窗）", async () => {
    const { deps: d } = deps(savedWithLoginOnly, false);
    await expect(saveProviderConfig("add", codexAfterLogin, d)).resolves.toBe(false);
  });
});
