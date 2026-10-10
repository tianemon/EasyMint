import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mapSessionMessages } from "./chat-utils";
import { buildBlocks, ChatBlockView } from "./ChatBlocks";
import { updateNestedCalls } from "@shared/nested-calls";

vi.mock("../lib/diff-highlight", () => ({ inferLang: () => undefined, tokenizeLines: () => [] }));

describe("native response metadata in history", () => {
  it("keeps physical models, zero timings and image preview paths after reopening", () => {
    const messages = mapSessionMessages([
      { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "image", name: "generate_image", input: {} }], timestamp: 1, durationMs: 0, provider: "physical", model: "fast" } },
      { type: "toolResult", message: { toolCallId: "image", content: [{ type: "text", text: "saved" }], durationMs: 1250, details: { generatedImagePath: "/project/asset.png" }, timestamp: 2 } },
    ]);
    expect(messages[0]).toMatchObject({ provider: "physical", model: "fast", durationMs: 0 });
    const blocks = buildBlocks(messages[0]!.entries!);
    expect(blocks[0]).toMatchObject({ kind: "tool-group", items: [{ durationMs: 1250, imagePath: "/project/asset.png", pending: false }] });
  });
  it("renders zero durations on read cards and standalone results", () => {
    const [read] = buildBlocks([{ kind: "tool_use", id: "read", name: "read", input: { path: "/project/file.txt" }, timestamp: 1, collapsed: false },
      { kind: "tool_result", toolUseId: "read", content: "file", isError: false, durationMs: 0, timestamp: 2 }]);
    expect(renderToStaticMarkup(createElement(ChatBlockView, { block: read! }))).toContain("0.0s");
    const [result] = buildBlocks([{ kind: "tool_result", toolUseId: "missing", name: "generate_image", content: "saved", isError: false, durationMs: 1250, imagePath: "/project/asset.png", timestamp: 2 }]);
    const html = renderToStaticMarkup(createElement(ChatBlockView, { block: result! }));
    expect(html).toContain("asset.png"); expect(html).toContain("1.3s");
  });
  it("leaves old replies untimed and forwards nested execution duration", () => {
    const [message] = mapSessionMessages([{ type: "assistant", message: { content: [{ type: "text", text: "old" }] } }]);
    expect(message?.durationMs).toBeUndefined();
    expect(updateNestedCalls(undefined, { toolCallId: "nested", nestedPhase: "end", durationMs: 0 }).calls[0]?.durationMs).toBe(0);
  });
});
