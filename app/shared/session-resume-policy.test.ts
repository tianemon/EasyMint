import { describe, expect, it } from "vitest";
import { sessionOverrides } from "./session-resume-policy";

describe("session resume overrides", () => {
  it("does not override transcript state when an old session has no owned cache values", () => {
    expect(sessionOverrides({
      existingSession: true, modelOwned: false, thinkingOwned: false,
      model: "global-model", provider: "global-provider", thinkingLevel: "high",
    })).toEqual({ model: undefined, provider: undefined, thinkingLevel: undefined });
  });

  it("passes explicit session values while keeping unrelated transcript state", () => {
    expect(sessionOverrides({
      existingSession: true, modelOwned: true, thinkingOwned: false,
      model: "session-model", provider: "session-provider", thinkingLevel: "high",
    })).toEqual({ model: "session-model", provider: "session-provider", thinkingLevel: undefined });
  });

  it("uses defaults when creating a new session", () => {
    expect(sessionOverrides({
      existingSession: false, modelOwned: false, thinkingOwned: false,
      model: "default-model", provider: "default-provider", thinkingLevel: "medium",
    })).toEqual({ model: "default-model", provider: "default-provider", thinkingLevel: "medium" });
  });
});
