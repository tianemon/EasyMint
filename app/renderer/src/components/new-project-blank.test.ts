// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog";
import { freshCreationData } from "./new-project/creation-rules";
import { PROJECT_DRAFT_KEY } from "./new-project/project-draft";

const model = vi.hoisted(() => ({
  askForm: vi.fn(),
  startSession: vi.fn(),
  disposeFormRequests: vi.fn(),
}));
vi.mock("./new-project/useMintChat", () => ({ useMintChat: () => model }));

it("a blank creation uses only the name and location even with guided defaults", async () => {
  const project = { id: "empty", name: "白板", path: "/fixture/白板", creationKind: "blank" };
  const create = vi.fn().mockResolvedValue(project);
  const saveProfile = vi.fn();
  const onCreated = vi.fn();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const previous = window.electronAPI;
  Object.defineProperty(window, "electronAPI", { configurable: true, value: {
    project: { create, saveProfile, checkDir: vi.fn().mockResolvedValue({ conflict: false }) },
  } });
  sessionStorage.setItem(PROJECT_DRAFT_KEY, JSON.stringify({
    data: { ...freshCreationData(), name: "白板", dir: "/fixture" }, step: 0,
  }));
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  vi.useFakeTimers();
  try {
    await act(async () => { root.render(createElement(NewProjectDialog, { onClose: vi.fn(), onCreated })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    const blank = document.querySelector<HTMLButtonElement>(".creation-wizard-direct");
    expect(blank?.disabled).toBe(false);
    await act(async () => { blank!.click(); });
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: "白板", path: "/fixture", kind: "blank" });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith(project);
    expect(saveProfile).not.toHaveBeenCalled();
    expect(model.askForm).not.toHaveBeenCalled();
    expect(model.startSession).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PROJECT_DRAFT_KEY)).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    sessionStorage.removeItem(PROJECT_DRAFT_KEY);
    Object.defineProperty(window, "electronAPI", { configurable: true, value: previous });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
