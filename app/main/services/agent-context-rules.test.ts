import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_DELIVERY_RULES, completeProjectRuleFiles, withAgentDeliveryRules } from "./agent-context-rules";
import { THINKING_LANGUAGE_PROMPT } from "../../shared/prompts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
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
});
