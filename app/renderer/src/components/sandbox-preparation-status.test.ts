import { expect, it } from "vitest";
import { acceptSandboxPreparation, type ActiveSandboxPreparation } from "./sandbox-preparation-status";

it("recognizes the real session during the pending first turn only for its own tab", () => {
  const event = { sessionId: "real", tabId: "tab-a", preparationId: "p1", state: "preparing" as const };
  expect(acceptSandboxPreparation(null, event, "__new", "tab-a", true).accepted).toBe(true);
  expect(acceptSandboxPreparation(null, event, "__new", "tab-b", true).accepted).toBe(false);
  expect(acceptSandboxPreparation(null, event, "__new", "tab-a", false).accepted).toBe(false);
});
it("does not let an old worker completion clear a newer preparation", () => {
  const current: ActiveSandboxPreparation = { sessionId: "real", preparationId: "new", state: "preparing" };
  expect(acceptSandboxPreparation(current, { sessionId: "real", preparationId: "old", state: "stopped" }, "real", "tab", false)).toEqual({ accepted: false, current });
  expect(acceptSandboxPreparation(current, { sessionId: "real", preparationId: "new", state: "ready" }, "real", "tab", false)).toEqual({ accepted: true, current: null });
});
