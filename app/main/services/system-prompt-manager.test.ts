import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MINT_SYSTEM_PROMPT } from "../../shared/prompts";

vi.mock("electron", () => ({ app: { isPackaged: false } }));
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "em-prompt-read-"));
  vi.stubEnv("EASYMINT_HOME", root);
  vi.resetModules();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs(); vi.resetModules();
});

describe("prompt runtime after removing unused editing APIs", () => {
  it("uses the current builtin prompt when there is no saved configuration", async () => {
    const { resolveEffectivePrompt } = await import("./system-prompt-manager");
    expect(resolveEffectivePrompt()).toBe(MINT_SYSTEM_PROMPT);
    expect(fs.existsSync(path.join(root, "system-prompts.json"))).toBe(false);
  });

  it.each(["custom", "builtin-default"])("keeps saved configuration and resolves selected prompt %s", async selected => {
    const file = path.join(root, "system-prompts.json");
    const original = JSON.stringify({ defaultPromptId: selected, prompts: [
      { id: "builtin-default", content: "old-builtin", isBuiltin: true },
      { id: "custom", content: "saved-custom-prompt", isBuiltin: false },
    ] });
    fs.writeFileSync(file, original);
    const { resolveEffectivePrompt } = await import("./system-prompt-manager");
    expect(resolveEffectivePrompt()).toBe(selected === "custom" ? "saved-custom-prompt" : MINT_SYSTEM_PROMPT);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });
});
