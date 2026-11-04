import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_DELIVERY_RULES, completeProjectRuleFiles, withAgentDeliveryRules } from "./agent-context-rules";
import { THINKING_LANGUAGE_PROMPT } from "../../shared/prompts";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-rule-files-")); roots.push(root);
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
  const source = (name: string) => ({ path: path.join(root, name), content: fs.readFileSync(path.join(root, name), "utf8") });
  return { root, source };
}

describe("public delivery responsibility", () => {
  it("updates an old app-owned block once, preserving custom content and the language tail", () => {
    const before = `CUSTOM_ROLE\n<easymint_delivery_rules>OLD_RULE</easymint_delivery_rules>\n\n${THINKING_LANGUAGE_PROMPT}`;
    const after = withAgentDeliveryRules(withAgentDeliveryRules(before));
    expect(after.startsWith("CUSTOM_ROLE")).toBe(true);
    expect(after.split(AGENT_DELIVERY_RULES)).toHaveLength(2);
    expect(after).not.toContain("OLD_RULE");
    expect(after.endsWith(THINKING_LANGUAGE_PROMPT)).toBe(true);
  });
});

describe("project rule completion", () => {
  it("adds CLAUDE even when AGENTS is empty; preserves order and original content", () => {
    const { source } = fixture({ "AGENTS.md": "", "CLAUDE.md": "\uFEFFUSE_PNPM" });
    const agents = source("AGENTS.md");
    const result = completeProjectRuleFiles([agents]);
    expect(result[0]).toBe(agents);
    expect(result.map(file => file.content)).toEqual(["", "USE_PNPM"]);
    expect(completeProjectRuleFiles(result)).toEqual(result);
  });
  it("leaves override-selected directories alone", () => {
    const { source } = fixture({ "AGENTS.override.md": "OVERRIDE", "AGENTS.md": "IGNORED", "CLAUDE.md": "IGNORED_TOO" });
    expect(completeProjectRuleFiles([source("AGENTS.override.md")]).map(file => file.content)).toEqual(["OVERRIDE"]);
  });
  it("does not duplicate a CLAUDE symlink to an already loaded AGENTS file", () => {
    const { root, source } = fixture({ "AGENTS.md": "SAME_SOURCE" });
    fs.symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));
    expect(completeProjectRuleFiles([source("AGENTS.md")])).toHaveLength(1);
  });
  it("supports uppercase fallback without creating missing files", () => {
    const { source } = fixture({ "AGENTS.md": "PROJECT", "CLAUDE.MD": "TEAM" });
    expect(completeProjectRuleFiles([source("AGENTS.md")]).map(file => file.content)).toEqual(["PROJECT", "TEAM"]);
    expect(completeProjectRuleFiles([])).toEqual([]);
  });
  it("retains the primary rules and diagnoses an unreadable supplement once", () => {
    const { root, source } = fixture({ "AGENTS.md": "PRIMARY", "CLAUDE.md": "UNREADABLE" });
    const primary = source("AGENTS.md");
    const read = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      if (String(args[0]).toLowerCase() === path.join(root, "CLAUDE.md").toLowerCase()) throw Object.assign(new Error("fixture denied"), { code: "EACCES" });
      return read(...args);
    });
    const warn = vi.fn();
    expect(completeProjectRuleFiles([primary], warn)).toEqual([primary]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("EACCES");
  });
  it("keeps an SDK snapshot if its file disappears before identity deduplication", () => {
    const { source } = fixture({ "AGENTS.md": "LOADED_SNAPSHOT" });
    const primary = source("AGENTS.md"); fs.unlinkSync(primary.path);
    expect(completeProjectRuleFiles([primary])).toEqual([primary]);
  });
  it("does not hide programming errors as optional-resource failures", () => {
    const { source } = fixture({ "AGENTS.md": "PRIMARY", "CLAUDE.md": "TEAM" });
    const primary = source("AGENTS.md");
    vi.spyOn(fs, "statSync").mockImplementation(() => { throw new TypeError("fixture programming error"); });
    expect(() => completeProjectRuleFiles([primary])).toThrow("fixture programming error");
  });
});
