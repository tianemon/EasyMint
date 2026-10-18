import { describe, expect, it, vi } from "vitest";
import { PROJECT_CREATION_GUIDE_KEY, PROJECT_CREATION_GUIDE_REPLAY_KEY, projectCreationGuideMode, resetOnboardingProgress } from "./onboarding-progress";

function progress() {
  const values = new Map([["easymint_setup_complete", "true"], [PROJECT_CREATION_GUIDE_KEY, "dismissed"], ["easymint_project_draft_v1", "draft"], ["unrelated", "keep"]]);
  return { values, storage: { setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } };
}
describe("onboarding rerun", () => {
  it("replays the project guide without removing unrelated progress or draft data", async () => {
    const { values, storage } = progress();
    const set = vi.fn(async (complete: boolean) => { expect(complete).toBe(false); expect(values.get("easymint_setup_complete")).toBe("true"); });
    const session = new Map<string, string>();
    await resetOnboardingProgress(set, storage, { setItem: (key, value) => { session.set(key, value); } });
    expect(set).toHaveBeenCalledOnce();
    expect(values.has("easymint_setup_complete")).toBe(false);
    expect(values.get(PROJECT_CREATION_GUIDE_KEY)).toBe("dismissed");
    expect(session.get(PROJECT_CREATION_GUIDE_REPLAY_KEY)).toBe("true");
    expect(values.get("easymint_project_draft_v1")).toBe("draft");
    expect(values.get("unrelated")).toBe("keep");
  });
  it("leaves local progress intact if the main setting cannot be reset", async () => {
    const { values, storage } = progress();
    const before = [...values];
    const session = { setItem: vi.fn() };
    await expect(resetOnboardingProgress(async () => { throw new Error("write failed"); }, storage, session)).rejects.toThrow("write failed");
    expect([...values]).toEqual(before);
    expect(session.setItem).not.toHaveBeenCalled();
  });
  it("honors an explicit replay for existing projects and consumes it on dismissal", () => {
    expect(projectCreationGuideMode("existing-project", "dismissed", true)).toBe("replay");
    expect(projectCreationGuideMode("", "dismissed", true)).toBe("replay");
    expect(projectCreationGuideMode("existing-project", "dismissed")).toBe("off");
    expect(projectCreationGuideMode("", "dismissed")).toBe("off");
  });
  it("does not replay in a different window that has no pending request", () => {
    expect(projectCreationGuideMode("existing-project", "dismissed", false)).toBe("off");
    expect(projectCreationGuideMode("", "dismissed", false)).toBe("off");
  });
  it("retains automatic onboarding only for a fresh empty workspace", () => {
    expect(projectCreationGuideMode("", null)).toBe("automatic");
    expect(projectCreationGuideMode("existing-project", null)).toBe("off");
    expect(projectCreationGuideMode("", "old-progress")).toBe("off");
  });
});
