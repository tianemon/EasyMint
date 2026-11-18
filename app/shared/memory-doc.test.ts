import { expect, it } from "vitest";
import { sectionText, writeSection } from "./memory-doc";

const doc = `# MEMORY

## 规则

- 回答用中文
- 不跳过验证

## 记忆

- 旧条目 <!-- m:one -->
`;

it("reads a section body and stops at the next heading", () => {
  expect(sectionText(doc, "规则")).toBe("- 回答用中文\n- 不跳过验证");
  expect(sectionText(doc, "记忆")).toBe("- 旧条目 <!-- m:one -->");
});

it("returns null for a missing or empty section", () => {
  expect(sectionText(doc, "人设")).toBeNull();
  expect(sectionText("# MEMORY\n\n## 规则\n\n## 记忆\n", "规则")).toBeNull();
});

it("replaces a section in place and keeps the rest of the document", () => {
  const next = writeSection(doc, "规则", "- 只给结论");
  expect(next).toContain("## 规则\n\n- 只给结论");
  expect(next).toContain("- 旧条目 <!-- m:one -->");
  expect(next).not.toContain("不跳过验证");
});

it("removes the whole section when the body is empty", () => {
  const next = writeSection(doc, "规则", "");
  expect(next).not.toContain("## 规则");
  expect(next).toContain("- 旧条目 <!-- m:one -->");
});

it("appends a section that does not exist yet", () => {
  const next = writeSection("# MEMORY\n", "规则", "- 先验证");
  expect(next).toBe("# MEMORY\n\n## 规则\n\n- 先验证\n");
});


it("preserves nested role Markdown and fences without leaking bullets into memory",async()=>{
 const {encodeRoleBody,roleLineIndexes}=await import("./memory-doc");
 const role="## 身份\n- 我叫Mint\n\n````md\n## 规则\n```\n````\n\n## 做事方式\n- 先核实";
 const text=writeSection("# MEMORY\n\n## 关于用户\n- 用户偏好中文\n","人设",encodeRoleBody(role));
 expect(sectionText(text,"人设")).toBe(role);expect(sectionText(text,"关于用户")).toContain("用户偏好中文");
 const protectedLines=roleLineIndexes(text);expect(text.split("\n").filter((_,i)=>protectedLines.has(i)).join("\n")).toContain("- 先核实");
});
