import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { createEnhancedBashTool } from "./tool";

describe("前台 bash 增量输出", () => {
  it("执行中经 onUpdate 推送 stdout", async () => {
    const tool = await createEnhancedBashTool(process.cwd());
    const updates: string[] = [];
    const onUpdate = (partial: { content: Array<{ type: string; text: string }> }): void => {
      updates.push(partial.content.map((c) => c.text).join(""));
    };
    const res = await (tool as unknown as {
      execute: (id: string, p: Record<string, unknown>, s: undefined, u: typeof onUpdate, ctx: unknown) => Promise<{ content: Array<{ text: string }> }>;
    }).execute("id1", { command: "echo hello-em-live" }, undefined, onUpdate, {});
    expect(updates.join("")).toContain("hello-em-live");
    expect(res.content[0]!.text).toContain("hello-em-live");
  }, 60_000);
});
