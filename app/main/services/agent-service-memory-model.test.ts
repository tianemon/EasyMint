import fs from "node:fs";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { AgentService } from "./agent-service";
import { writeCache } from "./session-cache";
import type { Store } from "./store";

const fixture = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs"), os = process.getBuiltinModule("node:os"), path = process.getBuiltinModule("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-memory-model-"));
  vi.stubEnv("EASYMINT_HOME", root);
  const current = { provider: "current", id: "default-model" };
  const chosen = { provider: "current", id: "session-model" };
  const old = { provider: "old", id: "old-model" };
  const runtime = { getModel: (provider: string, id: string) => [current, chosen, old].find(model => model.provider === provider && model.id === id) };
  return { root, current, chosen, old, runtime };
});
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./native-config", () => ({ getNativeConfig: async () => ({
  getRuntime: async () => fixture.runtime,
  getDefaultModel: () => fixture.current,
  modelConfigRevision: () => "fixture",
  resolveProviderId: (id: string) => id,
}) }));
vi.mock("./pi-init", () => ({ getModelRuntime: async () => fixture.runtime, getActiveModel: async () => fixture.current }));

const services: AgentService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.memory.close(); });
afterAll(() => { vi.unstubAllEnvs(); fs.rmSync(fixture.root, { recursive: true, force: true }); });

function setup(id: string, active?: typeof fixture.chosen) {
  const providers = { current: "current", configs: { current: { model: fixture.current.id }, old: { model: fixture.old.id } } };
  const store = { getSettings: () => ({ apiProviders: providers, memory: { enabled: false, background: false } }) } as unknown as Store;
  const service = new AgentService(store);
  services.push(service);
  if (active) {
    const chats = (service as unknown as { activeChats: Map<string, unknown> }).activeChats;
    chats.set(id, { chatId: id, sessionId: id, session: { model: active } });
  }
  const { deps } = service.memory as unknown as { deps: { getBackend: (sessionId: string) => Promise<unknown> } };
  return deps.getBackend(id);
}

it("prefers the live main session model over the cache", async () => {
  writeCache("live", { model: fixture.current.id });
  await expect(setup("live", fixture.chosen)).resolves.toMatchObject({ runtime: fixture.runtime, model: fixture.chosen });
});

it("uses the cached session selection when its chat is closed", async () => {
  writeCache("closed", { model: fixture.chosen.id });
  await expect(setup("closed")).resolves.toMatchObject({ runtime: fixture.runtime, model: fixture.chosen });
});

it("cancels pending background work when an inactive chat changes model", async () => {
  const original = await setup("cold-switch") as { isCurrent: (beforeRequest: boolean) => boolean };
  const service = services.at(-1)!;
  const pause = vi.spyOn(service.memory, "frontActivity");
  await service.setModel("cold-switch", fixture.chosen.id);
  expect(pause).toHaveBeenCalledOnce();
  expect(original.isCurrent(true)).toBe(false);
});

it("uses the same fallback as chat when the saved model is unavailable", async () => {
  writeCache("stale", { model: "removed-model" });
  await expect(setup("stale")).resolves.toMatchObject({ runtime: fixture.runtime, model: fixture.current });
});

it("follows the current supplier even when the active chat has not rebound yet", async () => {
  await expect(setup("changed-supplier", fixture.old)).resolves.toMatchObject({ runtime: fixture.runtime, model: fixture.current });
});
