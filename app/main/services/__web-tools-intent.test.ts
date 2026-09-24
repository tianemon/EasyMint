/**
 * 内置联网两件套（web_search / web_fetch）的**意图字段接线**守卫。
 *
 * 背景：MCP 工具已用「给模型看的 schema 加 `_intent`、转发前剥掉」的办法让聊天页
 * 不展开也能看出这次调用在做什么（见 mcp-adapter.ts）。内置的两个联网工具同样需要——
 * 它们的动作词（"搜索网页"/"抓取网页"）也是零信息量，用户想知道的是**搜了什么/抓了哪个站**。
 *
 * 另一半是**去重说明**：实测模型会同时调 web_search 与 mcp__tavily__search 查同一个问题
 * （底层都是 Tavily），描述里必须写明二者等价、只用一个。这里把那句话钉成断言。
 */
import { describe, expect, it, vi } from "vitest";

// vi.hoisted：mock 工厂在 import 阶段就执行，闭包变量必须 hoist 出去，否则 TDZ
const h = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

vi.mock("electron", () => ({ app: { isPackaged: false } }));
vi.mock("./ipc-broadcast", () => ({ broadcast: () => {} }));
vi.mock("./hooks", () => ({ validateTaskStatus: () => undefined }));
// defineTool 原样返回：被测的是我们拼的工具定义本身，不需要 pi 的真实包装
vi.mock("./pi-sdk", () => ({ getDefineToolFn: async () => (t: unknown) => t }));
vi.mock("./api-clients", () => ({
  isToolEnabled: () => true,
  webSearch: async (a: Record<string, unknown>) => { h.calls.push(a); return "搜索结果"; },
  webFetch: async (a: Record<string, unknown>) => { h.calls.push(a); return "抓取结果"; },
  describeImage: async () => "图片描述",
}));

import { createProductTools } from "./builtin-mcp";

type RawTool = {
  name: string;
  description: string;
  promptSnippet?: string;
  parameters: { properties: Record<string, unknown> };
  execute: (id: string, params: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;
};

async function tools(): Promise<RawTool[]> {
  return (await createProductTools("/tmp/fake-project")) as unknown as RawTool[];
}

describe("web_search / web_fetch 的意图字段", () => {
  it("给模型看的 schema 里带 _intent（否则模型无从填写）", async () => {
    const all = await tools();
    for (const name of ["web_search", "web_fetch"]) {
      const t = all.find((x) => x.name === name)!;
      expect(t, `${name} 应注册`).toBeTruthy();
      expect(t.parameters.properties._intent).toBeTruthy();
      // 必填项不能被意图字段挤掉
      expect(t.parameters.properties.query ?? t.parameters.properties.url).toBeTruthy();
    }
  });

  it("描述里要求模型每次都填 _intent，且 snippet 仍是首句（没被要求句污染）", async () => {
    const all = await tools();
    const search = all.find((x) => x.name === "web_search")!;
    expect(search.description).toContain("_intent");
    expect(search.promptSnippet).toBe("联网搜索并返回结果摘要");
  });

  it("转发给 Tavily 前剥掉 _intent（那是 EM 自己加的展示字段）", async () => {
    h.calls.length = 0;
    const all = await tools();
    const search = all.find((x) => x.name === "web_search")!;
    const fetch = all.find((x) => x.name === "web_fetch")!;
    const sr = await search.execute("id", { query: "某关键词", _intent: "查竞品资料" });
    const fr = await fetch.execute("id", { url: "https://a.com", _intent: "读官方文档" });
    expect(h.calls).toEqual([{ query: "某关键词" }, { url: "https://a.com" }]);
    expect(sr.content[0]!.text).toBe("搜索结果");
    expect(fr.content[0]!.text).toBe("抓取结果");
  });
});

describe("与 Tavily MCP 等价：描述里必须写明「只用一个」", () => {
  it("点名 tavily 服务器并说明要先查找——不再指向已不存在的工具名", async () => {
    const all = await tools();
    const search = all.find((x) => x.name === "web_search")!;
    const fetch = all.find((x) => x.name === "web_fetch")!;
    // 实测：模型不知道二者同源，会为同一个问题各调一次（重复消耗额度、结果重复）
    expect(search.description).toContain("同一个东西");
    expect(fetch.description).toContain("同一个东西");
    // 「MCP 按需加载」后 mcp__tavily__* 不再出现在工具列表里，描述必须按"先查找"指路。
    // 旧断言锚定的正是「工具列表里的 mcp__tavily__search」那套已失效的写法，这里连反例一起钉住。
    for (const d of [search.description, fetch.description]) {
      expect(d).toContain("MCP 服务器 tavily");
      expect(d).toContain("search_mcp_tools");
      expect(d).not.toContain("工具列表里的");
    }
  });
});
