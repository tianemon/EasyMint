/**
 * 工具卡片「不展开也看得出做了什么」的接线守卫。
 *
 * 背景：MCP 工具的标题行原本只有类别词「MCP」（零信息量），具体名 `tavily / search`
 * 在展开区。本次把具体名提到标题行，并补上意图（模型填的 `_intent`，缺失时回退参数摘要）。
 * 内置联网两件套（web_search / web_fetch）同机制——动作词同样零信息量，要的是「搜了什么 /
 * 抓了哪个站」。这里钉住**接线**：纯函数的行为由 `app/shared/__tool-intent.test.ts` 覆盖。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 同 __chat-blocks-tail.test.ts：这两个依赖在 node 环境起不来（一个要 DOM、一个顶层 import monaco）
vi.mock("dompurify", () => ({ default: { sanitize: (s: string) => s } }));
vi.mock("../lib/diff-highlight", () => ({ inferLang: () => "TEXT", tokenizeLines: () => [] }));

import { ChatBlockView } from "./ChatBlocks";

/** 渲染一张 MCP/普通工具卡片（走导出的 ChatBlockView，不额外导出内部组件） */
function renderCard(item: {
  name: string;
  input: unknown;
  result?: string;
}): string {
  const block = { kind: "tool-group", items: [{ ...item, pending: false }] } as never;
  return renderToStaticMarkup(createElement(ChatBlockView, { block }));
}

describe("MCP 调用：标题行要能看出调了谁、做了什么", () => {
  it("标题行带具体名（server / tool）与模型填的意图", () => {
    const out = renderCard({
      name: "mcp__tavily__search",
      input: { query: "某关键词", _intent: "查竞品资料" },
      result: "结果文本",
    });
    expect(out).toContain("tavily / search");
    expect(out).toContain("查竞品资料");
  });

  it("模型没填 _intent 时回退到参数摘要（老会话也有东西看）", () => {
    const out = renderCard({
      name: "mcp__tavily__search",
      input: { query: "流式输出 渐隐" },
      result: "结果文本",
    });
    expect(out).toContain("流式输出 渐隐");
  });

  it("无参数也无 _intent 时至少显示具体名，不出现空的分隔符", () => {
    const out = renderCard({ name: "mcp__git__status", input: {}, result: "结果文本" });
    expect(out).toContain("git / status");
    expect(out).not.toContain("· ·");
  });

  it("非 MCP 工具不受影响：文件类仍显示文件名，不混进 server/tool 段", () => {
    const out = renderCard({ name: "read", input: { path: "/a/b.ts" }, result: "内容" });
    expect(out).toContain("b.ts");
    expect(out).not.toContain("read / ");
  });

  it("默认折叠：结果正文不渲染（展开才挂载，避免撑开气泡宽度）", () => {
    const out = renderCard({
      name: "mcp__tavily__search",
      input: { _intent: "查资料" },
      result: "独有结果标记XYZ",
    });
    expect(out).not.toContain("独有结果标记XYZ");
    // 标题行该有的三样都在：类别 + 具体名 + 意图
    expect(out).toContain("MCP");
    expect(out).toContain("tavily / search");
    expect(out).toContain("查资料");
  });
});

describe("内置联网工具：同机制展示意图", () => {
  it("标题行显示模型填的 _intent（动作词本身零信息量）", () => {
    expect(renderCard({ name: "web_search", input: { query: "某关键词", _intent: "查竞品资料" } }))
      .toContain("查竞品资料");
    expect(renderCard({ name: "web_fetch", input: { url: "https://a.com", _intent: "读官方文档" } }))
      .toContain("读官方文档");
  });

  it("漏填 _intent 时回退：搜索回退 query、抓取回退 url", () => {
    expect(renderCard({ name: "web_search", input: { query: "流式输出 渐隐" } }))
      .toContain("流式输出 渐隐");
    expect(renderCard({ name: "web_fetch", input: { url: "https://a.com/doc" } }))
      .toContain("https://a.com/doc");
  });

  it("其他内置工具不受影响：不因参数里恰好有 prompt 就冒出意图段", () => {
    const out = renderCard({ name: "describe_image", input: { path: "/a/b.png", prompt: "描述这张图" } });
    expect(out).toContain("查看图片");
    expect(out).not.toContain("描述这张图");
  });
});

describe("联网两件套的图标要能互相区分", () => {
  it("搜索 = world-search（地球 + 放大镜），抓取 = world-download（地球 + 下箭头）", () => {
    const search = renderCard({ name: "web_search", input: { query: "x" } });
    const fetch = renderCard({ name: "web_fetch", input: { url: "https://a.com" } });
    // 共有：地球外圈
    expect(search).toContain("M21 12a9 9 0 1 0 -9 9");
    expect(fetch).toContain("M21 12a9 9 0 1 0 -9 9");
    // 各自的动作部件：放大镜柄 / 下箭头
    expect(search).toContain("M20.2 20.2l1.8 1.8");
    expect(fetch).toContain("M18 14v7m-3 -3l3 3l3 -3");
    expect(search).not.toContain("M18 14v7m-3 -3l3 3l3 -3");
    expect(fetch).not.toContain("M20.2 20.2l1.8 1.8");
  });

  it("旧的通用放大镜不再用于联网工具（它俩原本共用同一枚，看不出区别）", () => {
    expect(renderCard({ name: "web_search", input: { query: "x" } })).not.toContain("m21 21-4.34-4.34");
    expect(renderCard({ name: "web_fetch", input: { url: "https://a.com" } })).not.toContain("m21 21-4.34-4.34");
  });
});

describe("按需入口（search_mcp_tools / call_mcp_tool）：同样要能看出调了谁、做了什么", () => {
  it("call_mcp_tool：具体名取自 input.name，意图取自 input.intent", () => {
    const out = renderCard({
      name: "call_mcp_tool",
      input: { name: "mcp__playwright__browser_navigate", arguments: { url: "https://a.com" }, intent: "打开官网" },
      result: "结果文本",
    });
    expect(out).toContain("playwright / browser_navigate");
    expect(out).toContain("打开官网");
    expect(out).toContain("MCP");
  });

  it("call_mcp_tool：意图只认外层 intent——若误用参数摘要，这里会退化成工具名", () => {
    const out = renderCard({
      name: "call_mcp_tool",
      input: { name: "mcp__playwright__browser_click", arguments: { _intent: "内层字段" }, intent: "点登录按钮" },
      result: "结果文本",
    });
    // intentFromInput 走的是顶层 `_intent` / 参数摘要：此处应显示模型填的外层意图，而不是工具名
    expect(out).toContain("点登录按钮");
  });

  it("search_mcp_tools：显示在查哪个 server，以及查了什么", () => {
    const out = renderCard({
      name: "search_mcp_tools",
      input: { server: "playwright", query: "screenshot navigate" },
      result: "结果文本",
    });
    expect(out).toContain("查找 playwright");
    expect(out).toContain("screenshot navigate");
  });
});
