import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSettingsManager } from "./pi-init";

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("Pi cache warming compatibility", () => {
  it.each([undefined, "off", "streaming", "idle"] as const)("limits global choice %s without writing settings", async (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-warming-"));
    roots.push(root);
    const agentDir = path.join(root, "agent");
    fs.mkdirSync(agentDir);
    const file = path.join(agentDir, "settings.json");
    const contents = JSON.stringify(mode ? { cacheWarming: mode } : {});
    fs.writeFileSync(file, contents);
    const manager = await getSettingsManager(root, agentDir);
    expect(manager.getCacheWarmingMode()).toBe(mode === "off" ? "off" : "streaming");
    expect(fs.readFileSync(file, "utf8")).toBe(contents);
  });

  it("stops Pi's actual scheduled warmer when a session settles even if global settings say idle", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-warming-"));
    roots.push(root);
    const agentDir = path.join(root, "agent");
    fs.mkdirSync(agentDir);
    const contents = JSON.stringify({ cacheWarming: "idle" });
    fs.writeFileSync(path.join(agentDir, "settings.json"), contents);
    const settings = await getSettingsManager(root, agentDir);
    const file = path.resolve("node_modules/@earendil-works/pi-coding-agent/dist/core/cache-warmer.js");
    const { CacheWarmer } = await import(pathToFileURL(file).href);
    vi.useFakeTimers();
    const streamSimple = vi.fn();
    const warmer = new CacheWarmer({ streamSimple }, { getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 1_000_000, cacheRead: 0, cacheWrite: 0 } } }], appendUsage: vi.fn() }, () => settings.getCacheWarmingMode());
    warmer.start({ model: { id: "m", provider: "p", api: "openai-completions", promptCache: { short: 20 }, cost: { input: 10, output: 10, cacheRead: 1, cacheWrite: 10 } }, context: {}, options: {} }, () => true);
    expect(warmer.status.state).toBe("scheduled");
    warmer.onAgentSettled();
    expect(warmer.status).toMatchObject({ state: "inactive", reason: "agent run settled" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(streamSimple).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8")).toBe(contents);
  });
});
