import { expect, it } from "vitest";
import {
  entryRevision,
  newEntryKey,
  parseEntries,
  removeEntry,
  renderForPrompt,
  upsertEntry,
} from "./memory-entries";

const BASE = `# MEMORY

- 别先给方案再问要不要做 <!-- m:aaa111 -->
- 这个目录不许动 <!-- m:bbb222 -->
`;

it("解析条目并保留 key，缺 key 的行按正文派生", () => {
  const entries = parseEntries(`${BASE}- 手写的一条没有标记\n`);
  expect(entries.map((entry) => entry.key)).toEqual(["aaa111", "bbb222", newEntryKey("手写的一条没有标记")]);
  expect(entries[0]!.text).toBe("别先给方案再问要不要做");
});

it("同 key 覆盖正文并保持原位置，不产生重复条目", () => {
  const next = upsertEntry(BASE, { key: "aaa111", text: "先给结论，再问要不要细化" });
  const entries = parseEntries(next);
  expect(entries).toHaveLength(2);
  expect(entries[0]).toMatchObject({ key: "aaa111", text: "先给结论，再问要不要细化" });
  expect(entries[1]!.key).toBe("bbb222");
});

it("新条目追加到末尾，且 key 稳定可复用", () => {
  const next = upsertEntry(BASE, { text: "在意：本机只有 8GB" });
  const entries = parseEntries(next);
  expect(entries).toHaveLength(3);
  const again = upsertEntry(next, { text: "在意：本机只有 8GB" });
  expect(parseEntries(again)).toHaveLength(3);
});

it("revision 只由正文派生：同文本同版本，改一个字就变", () => {
  expect(entryRevision("abc")).toBe(entryRevision("abc"));
  expect(entryRevision("abc")).not.toBe(entryRevision("abd"));
  expect(entryRevision("abc")).toMatch(/^[a-f0-9]{64}$/u);
});

it("删除按 key 精确移除，不影响其它条目", () => {
  const entries = parseEntries(removeEntry(BASE, "bbb222"));
  expect(entries.map((entry) => entry.key)).toEqual(["aaa111"]);
  expect(removeEntry("", "x")).toBe("");
});

it("注入文本去掉内部 key 标记，并有长度上限", () => {
  const prompt = renderForPrompt(parseEntries(BASE));
  expect(prompt).not.toContain("<!--");
  expect(prompt).toContain("- 别先给方案再问要不要做");
  expect(renderForPrompt(parseEntries(BASE), 10).length).toBeLessThanOrEqual(10);
});

it("回写只动条目行，标题与说明段落原样保留", () => {
  const withTitle = `# MEMORY\n\n> 这里的条目可以手改。\n\n${BASE.split("\n").slice(2).join("\n")}`;
  const next = upsertEntry(withTitle, { key: "aaa111", text: "改了内容" });
  expect(next).toContain("# MEMORY");
  expect(next).toContain("> 这里的条目可以手改。");
  expect(next).toContain("- 改了内容 <!-- m:aaa111 -->");
  expect(next).not.toContain("别先给方案再问要不要做");
  expect(next.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
});
