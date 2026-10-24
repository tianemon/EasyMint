import { describe, expect, it, vi } from "vitest";
vi.mock("../../stores/settings-store", () => ({ useSettingsStore: { getState: () => ({ defaultProjectDir: "/projects" }) } }));
const { DEFAULT_DATA } = await import("./ProjectFormTypes");
const { isRecoverableProject, matchesCreationInput, parsePendingCreation, prepareCreationProject, recommendationContextChanged } = await import("./project-creation");
const { parseProjectDraft } = await import("./project-draft");

const project: Project = { id: "created", name: "小账本", path: "/projects/budget-book", createdAt: "", lastOpenedAt: "", status: "setup", description: "" };
const pending = { projectId: project.id, projectPath: project.path, name: project.name, baseDir: "/projects", directoryName: "budget-book" };
const input = { ...DEFAULT_DATA, name: project.name, dir: "/projects" };
const api = () => ({ get: vi.fn(async () => ({ ...project, exists: true })), create: vi.fn(async () => project) });

describe("project creation identity and recovery", () => {
  it("creates with separate display and directory names", async () => {
    const service = api();
    const resolve = vi.fn(async () => "budget-book");
    const result = await prepareCreationProject(input, undefined, service, resolve);
    expect(service.create).toHaveBeenCalledWith({ name: "小账本", directoryName: "budget-book", path: "/projects" });
    expect(result?.pending).toEqual(pending);
    expect(result?.project.name).toBe("小账本");
  });

  it("recovers a registered project after draft serialization without creating or retranslating", async () => {
    const draft = parseProjectDraft(JSON.stringify({ data: input, step: 3, pendingCreation: pending }))!;
    const service = api();
    const resolve = vi.fn(async () => "another-translation");
    const result = await prepareCreationProject(draft.data, draft.pendingCreation, service, resolve);
    expect(result?.project.id).toBe(project.id);
    expect(service.get).toHaveBeenCalledWith(project.id);
    expect(service.create).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([{ name: "A different project" }, { dir: "/another-location" }])("creates a new identity after edits: %j", async patch => {
    const edited = { ...input, ...patch };
    const service = api();
    service.create.mockResolvedValue({ ...project, id: "new-project", name: edited.name, path: `${edited.dir}/new-folder` });
    const result = await prepareCreationProject(edited, pending, service, async () => "new-folder");
    expect(service.get).not.toHaveBeenCalled();
    expect(service.create).toHaveBeenCalledWith({ name: edited.name, path: edited.dir, directoryName: "new-folder" });
    expect(result?.project.id).toBe("new-project");
    expect(result?.pending.projectId).toBe("new-project");
  });

  it.each([
    undefined, { ...project, exists: false }, { ...project, exists: true, path: "/moved" },
    { ...project, exists: true, name: "Renamed" }, { ...project, exists: true, status: "development" as const },
    { ...project, exists: true, id: "another-project" },
  ])("rejects stale or mismatched recovery hints without creating over an existing directory", async registered => {
    const service = { get: vi.fn(async () => registered), create: vi.fn(async () => project) };
    const result = await prepareCreationProject(input, pending, service, async () => "budget-book");
    expect(result).toBeNull();
    expect(service.create).not.toHaveBeenCalled();
    expect(isRecoverableProject(pending, registered)).toBe(false);
  });

  it("retains the recovery hint on a transient validation failure", async () => {
    const service = api();
    service.get.mockRejectedValue(new Error("temporary failure"));
    await expect(prepareCreationProject(input, pending, service, async () => "budget-book")).rejects.toThrow("temporary failure");
    expect(service.create).not.toHaveBeenCalled();
    expect(pending.projectId).toBe("created");
  });

  it("parses only complete recovery metadata and keeps it outside editable data", () => {
    expect(parsePendingCreation({ projectId: "unverified" })).toBeUndefined();
    expect(parsePendingCreation({ ...pending, projectPath: false })).toBeUndefined();
    expect(parsePendingCreation({ ...pending, extra: "ignored" })).toEqual(pending);
    const restored = parseProjectDraft(JSON.stringify({ data: { ...input, projectId: "untrusted" }, pendingCreation: pending }))!;
    expect(restored.pendingCreation).toEqual(pending);
    expect(restored.data).not.toHaveProperty("projectId");
    expect(matchesCreationInput(pending, { ...input, dir: "/projects/" })).toBe(true);
    expect(isRecoverableProject({ ...pending, directoryName: "wrong-folder" }, { ...project, exists: true })).toBe(false);
  });
});

describe("recommendation input versions", () => {
  it.each([{ name: "new name" }, { description: "new idea" }, { scene: "learning" as const }, { targets: ["wechat-miniprogram"] }])("invalidates the old request for %j", patch => {
    expect(recommendationContextChanged(input, patch)).toBe(true);
  });
  it("keeps the response valid for manual feature edits, location changes, or an unchanged platform", () => {
    expect(recommendationContextChanged(input, { features: [{ name: "Manual feature" }] })).toBe(false);
    expect(recommendationContextChanged(input, { dir: "/another-location" })).toBe(false);
    expect(recommendationContextChanged(input, { targets: [...input.targets] })).toBe(false);
  });
});
