import { describe, expect, it } from "vitest";
import { sessionOverrides } from "./session-resume-policy";

describe("session resume overrides", () => {
  it("does not override transcript state when an old session has no owned cache values", () => {
    expect(sessionOverrides({
      existingSession: true, modelOwned: false, thinkingOwned: false,
      model: "global-model", thinkingLevel: "high",
    })).toEqual({ model: undefined, thinkingLevel: undefined });
  });

  it("passes explicit session values while keeping unrelated transcript state", () => {
    expect(sessionOverrides({
      existingSession: true, modelOwned: true, thinkingOwned: false,
      model: "session-model", thinkingLevel: "high",
    })).toEqual({ model: "session-model", thinkingLevel: undefined });
  });

  it("uses defaults when creating a new session", () => {
    expect(sessionOverrides({
      existingSession: false, modelOwned: false, thinkingOwned: false,
      model: "default-model", thinkingLevel: "medium",
    })).toEqual({ model: "default-model", thinkingLevel: "medium" });
  });
});
