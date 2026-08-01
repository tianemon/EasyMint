import { describe, it, expect } from "vitest";
import { blocksToMarkdown, inlineToMd, type SelBlock } from "./selection-to-markdown";

describe("blocksToMarkdown", () => {
  it("段落", () => {
    const blocks: SelBlock[] = [{ type: "para", text: "你好" }];
    expect(blocksToMarkdown(blocks)).toBe("你好");
  });

  it("标题", () => {
    const blocks: SelBlock[] = [{ type: "heading", level: 2, text: "需求" }];
    expect(blocksToMarkdown(blocks)).toBe("## 需求");
  });

  it("无序列表", () => {
    const blocks: SelBlock[] = [{ type: "list", level: 1, items: ["a", "b"] }];
    expect(blocksToMarkdown(blocks)).toBe("- a\n- b");
  });

  it("有序列表", () => {
    const blocks: SelBlock[] = [{ type: "list", level: 2, items: ["a"] }];
    expect(blocksToMarkdown(blocks)).toBe("1. a");
  });

  it("代码块", () => {
    const blocks: SelBlock[] = [{ type: "code", items: ["const x = 1;"] }];
    expect(blocksToMarkdown(blocks)).toBe("```\nconst x = 1;\n```");
  });

  it("引用", () => {
    const blocks: SelBlock[] = [{ type: "quote", text: "注意" }];
    expect(blocksToMarkdown(blocks)).toBe("> 注意");
  });

  it("多块拼接换行", () => {
    const blocks: SelBlock[] = [
      { type: "heading", level: 1, text: "标题" },
      { type: "para", text: "正文" },
    ];
    expect(blocksToMarkdown(blocks)).toBe("# 标题\n正文");
  });
});

describe("inlineToMd", () => {
  it("加粗", () => expect(inlineToMd("strong", "加粗")).toBe("**加粗**"));
  it("斜体", () => expect(inlineToMd("em", "斜")).toBe("*斜*"));
  it("行内代码", () => expect(inlineToMd("code", "x")).toBe("`x`"));
  it("纯文本原样", () => expect(inlineToMd("", "普通")).toBe("普通"));
});
