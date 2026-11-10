import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSettingsManager } from "./pi-init";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("Pi cache warming compatibility", () => {
  it.each([undefined, "off", "streaming", "idle"] as const)("preserves global choice %s without writing settings", async (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-warming-"));
    roots.push(root);
    const agentDir = path.join(root, "agent");
    fs.mkdirSync(agentDir);
    const file = path.join(agentDir, "settings.json");
    const contents = JSON.stringify(mode ? { cacheWarming: mode } : {});
    fs.writeFileSync(file, contents);
    const manager = await getSettingsManager(root, agentDir);
    expect(manager.getCacheWarmingMode()).toBe(mode ?? "idle");
    expect(fs.readFileSync(file, "utf8")).toBe(contents);
  });
});
