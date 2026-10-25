// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatBlockView } from "./ChatBlocks";

vi.mock("../lib/diff-highlight", () => ({ inferLang: () => "TEXT", tokenizeLines: () => [] }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Remove animation delays, while still exercising the real fold hook and effects.
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(text: string, active: boolean): Promise<void> {
  await act(async () => root.render(createElement(ChatBlockView, {
    block: { kind: "thinking", text }, streaming: active, isStreamingTail: active,
  })));
}

describe("thinking disclosure after effects", () => {
  it("stays closed through mounting, stream growth, and stream completion", async () => {
    for (const [text, active] of [["internal reasoning", true], ["more internal reasoning", true], ["finished reasoning", false]] as const) {
      await render(text, active);
      expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
      expect(container.textContent).not.toContain(text);
    }
  });

  it("opens only on click and preserves the reader's choice as the stream changes", async () => {
    await render("internal reasoning", true);
    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("internal reasoning");
    await render("finished reasoning", false);
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    await act(async () => container.querySelector("button")!.click());
    await render("new internal reasoning", true);
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("new internal reasoning");
  });
});
