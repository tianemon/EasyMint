import { describe, it, expect } from "vitest";
import { detectClaude } from "./claude-detector";

describe("detectClaude", () => {
  it("应返回 DetectResult 对象", () => {
    const result = detectClaude();
    expect(result).toHaveProperty("found");
  });

  it("在真正 PATH 中应检测到 claude（开发环境）", () => {
    const result = detectClaude();
    expect(result.found).toBe(true);
    expect(result.path).toBeDefined();
    expect(result.version).toBeDefined();
    expect(result.version!.length).toBeGreaterThan(0);
  });

  it("空 PATH 应返回 found: false", () => {
    const result = detectClaude("");
    expect(result.found).toBe(false);
    expect(result.path).toBeUndefined();
    expect(result.version).toBeUndefined();
  });

  it("不包含 claude 的 PATH 应返回 found: false", () => {
    const result = detectClaude("/nonexistent/dir:/another/fake/path");
    expect(result.found).toBe(false);
  });
});
