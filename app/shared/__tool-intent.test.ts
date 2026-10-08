/**
 * 工具调用意图（`app/shared/tool-intent.ts`）的守卫测试。
 *
 * 钉住三件事：
 * ① **取值优先级**：模型填的 `_intent` > 参数摘要 > 不显示（不是显示占位）；
 * ② **schema 改写的防御**：schema 来自第三方 server，无法安全改写时必须原样返回；
 * ③ **剥离**：`_intent` 绝不能漏给 server（严格 server 会因未知参数拒绝整次调用）。
 */
import { describe, expect, it } from "vitest";
import {
  INTENT_PARAM,
  INTENT_REQUIREMENT,
  TOOL_DISPLAY_DESCRIPTION,
  intentFromInput,
  stripIntentParams,
  summarizeInput,
  withIntentParam,
} from "./tool-intent";

describe("取意图", () => {
  it("优先用模型填的 _intent（它才是「为什么调」）", () => {
    expect(intentFromInput({ [INTENT_PARAM]: "查竞品资料", query: "某关键词" })).toBe("查竞品资料");
  });

  it("没有 _intent 时回退到参数摘要（老会话/模型漏填）", () => {
    expect(intentFromInput({ query: "流式输出 渐隐" })).toBe("流式输出 渐隐");
    expect(intentFromInput({ url: "https://example.com/a" })).toBe("https://example.com/a");
    expect(intentFromInput({ name: "ui-sync" })).toBe("ui-sync");
  });

  it("两者都没有 → undefined：调用方该不显示，而不是显示占位", () => {
    expect(intentFromInput({})).toBeUndefined();
    expect(intentFromInput(undefined)).toBeUndefined();
    expect(intentFromInput(null)).toBeUndefined();
    expect(intentFromInput("text")).toBeUndefined();
    expect(intentFromInput([])).toBeUndefined();
  });

  it("空白串不算意图", () => {
    expect(intentFromInput({ [INTENT_PARAM]: "   " })).toBeUndefined();
  });

  it("超长截断（标题行只放得下一件事）", () => {
    const out = intentFromInput({ [INTENT_PARAM]: "a".repeat(80) });
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(28);
    expect(out!.endsWith("…")).toBe(true);
  });

  it("换行与多余空白压成单空格（否则标题行会塌行）", () => {
    expect(intentFromInput({ [INTENT_PARAM]: "查  资料\n并整理" })).toBe("查 资料 并整理");
  });
});

describe("参数摘要", () => {
  it("按优先键取第一个命中：query 优先于 url", () => {
    expect(summarizeInput({ url: "https://x", query: "关键词" })).toBe("关键词");
  });

  it("非字符串值跳过（数字/对象不算语义）", () => {
    expect(summarizeInput({ query: 123 as never })).toBeUndefined();
    expect(summarizeInput({ name: { a: 1 } as never })).toBeUndefined();
  });

  it("空串跳过，继续找下一个有值的键", () => {
    expect(summarizeInput({ query: "", url: "https://x" })).toBe("https://x");
  });
});

describe("给 schema 加 _intent", () => {
  it("正常对象型 schema：加字段，且不动原有字段", () => {
    const out = withIntentParam({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    }) as Record<string, any>;
    expect(out.properties[INTENT_PARAM]).toBeDefined();
    expect(out.properties.query).toEqual({ type: "string" });
    expect(out.required).toEqual(["query"]); // 不擅自加 required（保持可选最稳）
  });

  it("server 已占用 _intent 时不覆盖（不能毁掉真实参数）", () => {
    const serverField = { type: "string", description: "server 自己的含义" };
    const out = withIntentParam({ type: "object", properties: { [INTENT_PARAM]: serverField } }) as Record<string, any>;
    expect(out.properties[INTENT_PARAM]).toBe(serverField);
  });

  it("无法安全改写时原样返回——第三方 schema 千奇百怪，宁可不加也不能把工具搞挂", () => {
    expect(withIntentParam({ type: "string" })).toEqual({ type: "string" });
    expect(withIntentParam({ type: "object" })).toEqual({ type: "object" }); // 缺 properties
    expect(withIntentParam({ type: "object", properties: "bad" })).toEqual({ type: "object", properties: "bad" });
    expect(withIntentParam(false)).toBe(false);
    expect(withIntentParam(null)).toBe(null);
    expect(withIntentParam(undefined)).toBeUndefined();
    expect(withIntentParam([])).toEqual([]);
  });
});

describe("转发给 server 前剥离", () => {
  it("剥掉 _intent，其余完整保留", () => {
    expect(stripIntentParams({ a: 1, [INTENT_PARAM]: "x", b: "y" })).toEqual({ a: 1, b: "y" });
  });

  it("没有该字段时返回同一个对象引用（避免无谓拷贝）", () => {
    const params = { a: 1 };
    expect(stripIntentParams(params)).toBe(params);
  });

  it("非对象原样返回", () => {
    expect(stripIntentParams(null)).toBe(null);
    expect(stripIntentParams("x")).toBe("x");
    expect(stripIntentParams([1, 2])).toEqual([1, 2]);
  });
});

describe("工具说明里的要求", () => {
  it("要求句必须带参数名，否则模型不知道填什么", () => {
    expect(INTENT_REQUIREMENT).toContain(INTENT_PARAM);
  });

  it("display captions follow the user language without changing the tool parameter", () => {
    const schema = withIntentParam({ type: "object", properties: {} }) as { properties: Record<string, { description: string }> };
    expect(INTENT_REQUIREMENT).toContain(TOOL_DISPLAY_DESCRIPTION);
    expect(schema.properties[INTENT_PARAM]!.description).toContain("使用用户所用的语言");
    expect(INTENT_REQUIREMENT).not.toContain("一句话中文");
    expect(schema.properties[INTENT_PARAM]!.description).not.toContain("一句话中文");
    expect(stripIntentParams({ command: "echo unchanged", _intent: "Check the build" })).toEqual({ command: "echo unchanged" });
  });

  it("字段名用下划线前缀（避开 server 可能已有的 description 参数）", () => {
    expect(INTENT_PARAM).toBe("_intent");
  });
});
