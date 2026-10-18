import { describe, expect, it } from "vitest";
import { selectTopModal } from "./Modal";

describe("modal keyboard ownership follows visual layers", () => {
  it("keeps a confirmation above a later lower-tier pair request", () => {
    const confirmation = { name: "confirmation", tier: "modal" as const };
    const pairRequest = { name: "pair-request", tier: "dialog" as const };
    expect(selectTopModal([confirmation, pairRequest])).toBe(confirmation);
    expect(selectTopModal([pairRequest, confirmation])).toBe(confirmation);
  });

  it("uses opening order within a layer and hands ownership back after removal", () => {
    const wizard = { name: "wizard", tier: "dialog" as const };
    const preview = { name: "preview", tier: "dialog" as const };
    expect(selectTopModal([wizard, preview])).toBe(preview);
    expect(selectTopModal([wizard])).toBe(wizard);
    expect(selectTopModal([])).toBeUndefined();
  });
});
