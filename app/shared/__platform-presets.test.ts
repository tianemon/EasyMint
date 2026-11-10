/**
 * 供应商预设表的展示约定（用户明确要求过的两条，钉住防回退）：
 * 1. **OpenAI 与 OpenAI Codex 必须相邻**——同属 OpenAI，但认证方式相反（一个只能填密钥、
 *    一个只能账号登录），排在一起用户才看得出"这是两个不同的接入点"（用户 2026-09-15 要求）；
 * 2. GitHub Copilot 与 OpenRouter 在列表内（同一次要求）。
 */
import { describe, expect, it } from "vitest";
import { listPresets } from "./platform-presets";

describe("供应商预设表", () => {
  const presets = listPresets();

  it("OpenAI 与 OpenAI Codex 相邻排列", () => {
    const ids = presets.map((p) => p.id);
    const i = ids.indexOf("openai");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ids[i + 1]).toBe("openai-codex");
  });

  it("GitHub Copilot 与 OpenRouter 在列（两者都支持账号登录与 API Key）", () => {
    const ids = presets.map((p) => p.id);
    expect(ids).toContain("github-copilot");
    expect(ids).toContain("openrouter");
  });

  it("id 唯一（重复会让下拉出现两条同 id 选项，保存时互相覆盖）", () => {
    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("展示 Qwen Token Plan Individual 国内入口", () => {
    expect(presets.find((p) => p.id === "qwen-token-plan-individual-cn")).toMatchObject({ brandKey: "qwen" });
  });
});
