import { describe, expect, it } from "vitest";
import { shouldToastExtensionError } from "./pi-extension-error";

describe("shouldToastExtensionError", () => {
  it("keeps initialization-phase failures out of the chat, they belong to the plugins page", () => {
    // 每次建会话都会重跑的初始化阶段
    for (const event of ["load", "register_provider", "register_virtual_model", "register_mcp_server"]) {
      expect(shouldToastExtensionError(event)).toBe(false);
    }
  });

  it("still surfaces runtime hook failures, those are the current conversation's problem", () => {
    for (const event of ["tool_result", "message_end", "context", "input", "user_bash"]) {
      expect(shouldToastExtensionError(event)).toBe(true);
    }
  });

  it("defaults to showing an unknown or missing event instead of swallowing it", () => {
    expect(shouldToastExtensionError("some_future_hook")).toBe(true);
    expect(shouldToastExtensionError(undefined)).toBe(true);
    expect(shouldToastExtensionError("")).toBe(true);
  });
});
