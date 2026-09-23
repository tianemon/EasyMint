import { describe, expect, it } from "vitest";
import { canRewindDetachedUser } from "./rewind-policy";

describe("已撤回 user 气泡的分支例外", () => {
  it("打断后落在原父节点或其后的撤回 pin，允许改字重发", () => {
    expect(canRewindDetachedUser("parent", "parent")).toBe(true);
    expect(canRewindDetachedUser("parent", "pin", { parentId: "parent" })).toBe(true);
    expect(canRewindDetachedUser(null, "root-pin", { parentId: null })).toBe(true);
  });

  it("另一窗口从该父节点继续写过消息后，旧气泡不能截断新内容", () => {
    expect(canRewindDetachedUser("parent", "new-answer")).toBe(false);
    expect(canRewindDetachedUser("parent", "unrelated-pin", { parentId: "other" })).toBe(false);
  });
});
