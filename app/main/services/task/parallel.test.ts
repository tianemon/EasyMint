import { describe, expect, it } from "vitest";
import { mapWithConcurrencyLimit } from "./parallel";

describe("parallel failure settlement", () => {
  it("cancels sibling work and waits for its cleanup before rejecting", async () => {
    let fail!: () => void;
    let releaseCleanup!: () => void;
    const first = new Promise<void>((_, reject) => { fail = () => reject(new Error("first failed")); });
    const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
    let cancelled = false, cleaned = false;
    const work = mapWithConcurrencyLimit([0, 1], 2, async (item, _index, signal) => {
      if (item === 0) return await first;
      await new Promise<void>(resolve => signal.addEventListener("abort", () => { cancelled = true; resolve(); }, { once: true }));
      await cleanup; cleaned = true;
    });
    let settled = false;
    const result = work.catch(error => error).finally(() => { settled = true; });
    fail();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancelled).toBe(true);
    const premature = settled;
    releaseCleanup();
    expect((await result).message).toBe("first failed");
    expect(premature).toBe(false);
    expect(cleaned).toBe(true);
  });
});
