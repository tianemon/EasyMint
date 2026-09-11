/**
 * markdown 预览的路径判定与相对资源解析单测。
 *
 * 覆盖重点：Windows 反斜杠（marked 会把 \ 编码成 %5C）、`..` 回溯不越过根、
 * 外链/data:/绝对路径一律不改写——这些在界面上表现为「图片裂了」或「外链被本地读」，
 * 靠手点很难覆盖全。
 */
import { describe, it, expect } from "vitest";
import { dirOf, isMarkdownPath, resolveRelativePath } from "./markdown-path";

describe("isMarkdownPath（markdown 扩展名判定）", () => {
  it("识别 .md / .markdown，大小写不敏感", () => {
    expect(isMarkdownPath("/p/README.md")).toBe(true);
    expect(isMarkdownPath("/p/README.MD")).toBe(true);
    expect(isMarkdownPath("/p/docs/spec.markdown")).toBe(true);
    expect(isMarkdownPath("C:\\p\\docs\\Spec.MarkDown")).toBe(true);
  });

  it("非 markdown 与边界形态返回 false", () => {
    expect(isMarkdownPath("/p/a.mdx")).toBe(false);
    expect(isMarkdownPath("/p/a.txt")).toBe(false);
    expect(isMarkdownPath("/p/md")).toBe(false);
    expect(isMarkdownPath("/p/.md")).toBe(false); // 点文件（无文件名主干）
    expect(isMarkdownPath("")).toBe(false);
  });
});

describe("dirOf（取目录）", () => {
  it("兼容 / 与 \\ 分隔符", () => {
    expect(dirOf("/p/docs/a.md")).toBe("/p/docs");
    expect(dirOf("C:\\p\\docs\\a.md")).toBe("C:\\p\\docs");
    expect(dirOf("a.md")).toBe("");
  });
});

describe("resolveRelativePath（相对资源 → 绝对路径）", () => {
  it("相对路径拼到 md 所在目录", () => {
    expect(resolveRelativePath("/p/docs", "imgs/a.png")).toBe("/p/docs/imgs/a.png");
    expect(resolveRelativePath("/p/docs", "./imgs/a.png")).toBe("/p/docs/imgs/a.png");
    expect(resolveRelativePath("/p/docs", "../assets/a.png")).toBe("/p/assets/a.png");
    expect(resolveRelativePath("/p/docs", "sub/../imgs/a.png")).toBe("/p/docs/imgs/a.png");
  });

  it(".. 回溯不越过根", () => {
    // /p 的上一级就是根，再多的 .. 也停在根上
    expect(resolveRelativePath("/p", "../../a.png")).toBe("/a.png");
    expect(resolveRelativePath("C:\\p", "../../../a.png")).toBe("C:\\a.png");
  });

  it("Windows 路径：分隔符跟随目录，%5C 解码后可拼接", () => {
    expect(resolveRelativePath("C:\\p\\docs", "imgs/a.png")).toBe("C:\\p\\docs\\imgs\\a.png");
    expect(resolveRelativePath("C:\\p\\docs", "../a.png")).toBe("C:\\p\\a.png");
    // marked 会把 md 里的 C:\... 编码成 C:%5C...
    expect(resolveRelativePath("C:\\p\\docs", "C:%5Ctmp%5Ca.png")).toBe("C:\\tmp\\a.png");
  });

  it("外链 / data: / 锚点不动（返回 null）", () => {
    expect(resolveRelativePath("/p/docs", "https://e.com/a.png")).toBeNull();
    expect(resolveRelativePath("/p/docs", "http://e.com/a.png")).toBeNull();
    expect(resolveRelativePath("/p/docs", "//e.com/a.png")).toBeNull();
    expect(resolveRelativePath("/p/docs", "data:image/png;base64,AAA")).toBeNull();
    expect(resolveRelativePath("/p/docs", "#top")).toBeNull();
    expect(resolveRelativePath("/p/docs", "   ")).toBeNull();
  });

  it("已是绝对路径则原样返回", () => {
    expect(resolveRelativePath("/p/docs", "/tmp/a.png")).toBe("/tmp/a.png");
    expect(resolveRelativePath("/p/docs", "C:\\tmp\\a.png")).toBe("C:\\tmp\\a.png");
    // 带查询串的绝对路径不做剥离（主进程按原串取文件，扩展名判定也认得）
    expect(resolveRelativePath("/p/docs", "/tmp/a.png?raw=1")).toBe("/tmp/a.png?raw=1");
  });

  it("编码解码：空格与非法 % 序列", () => {
    expect(resolveRelativePath("/p/docs", "imgs/a%20b.png")).toBe("/p/docs/imgs/a b.png");
    // 解码失败退回原串——路径里本就有 % 时不该整条失效
    expect(resolveRelativePath("/p/docs", "imgs/100%.png")).toBe("/p/docs/imgs/100%.png");
  });

  it("没有基准目录时不解析", () => {
    expect(resolveRelativePath("", "imgs/a.png")).toBeNull();
  });
});
