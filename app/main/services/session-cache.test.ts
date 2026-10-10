import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const isolated = vi.hoisted(() => ({ root: "" }));
vi.mock("../utils/paths", () => ({ emHome: () => isolated.root }));
let cache: typeof import("./session-cache");
beforeEach(async () => {
  isolated.root = fs.mkdtempSync(path.join(os.tmpdir(), "em-cache-quality-"));
  vi.resetModules();
  cache = await import("./session-cache");
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(isolated.root, { recursive: true, force: true }); });

describe("session cache persistence boundaries", () => {
  it("rejects identifiers that escape the cache directory", () => {
    for (const id of ["../outside", "nested/id", "nested\\id", "", ".."])
      expect(() => cache.writeCache(id, { model: "fixture" })).toThrow();
    expect(fs.existsSync(path.join(isolated.root, "outside.json"))).toBe(false);
  });
  it("recovers from malformed UI cache without leaking the file contents", () => {
    cache.writeCache("session", { model: "fixture" });
    fs.writeFileSync(path.join(isolated.root, "session-cache", "session.json"), '{"secret-fragment');
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(cache.readCache("session")).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-fragment");
    cache.writeCache("session", { model: "replacement" });
    expect(cache.readCache("session")?.model).toBe("replacement");
  });
  it("preserves all caches when the session scan cannot complete", async () => {
    cache.writeCache("session", { model: "fixture" });
    fs.mkdirSync(path.join(isolated.root, "agent"));
    fs.writeFileSync(path.join(isolated.root, "agent", "sessions"), "not a directory");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await cache.cleanupOrphanCaches()).toBe(0);
    expect(cache.readCache("session")?.model).toBe("fixture");
  });
  it("removes proven orphans while retaining live and temporary cache identities", async () => {
    const id = "12345678-1234-1234-1234-123456789abc";
    const sessions = path.join(isolated.root, "agent", "sessions", "project");
    fs.mkdirSync(sessions, { recursive: true });
    fs.writeFileSync(path.join(sessions, `2026-10-10_${id}.jsonl`), JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: "/fixture" }) + "\n");
    for (const sid of [id, "orphan", "__new_fixture"]) cache.writeCache(sid, { model: "fixture" });
    const old = new Date(Date.now() - 1000);
    fs.utimesSync(path.join(isolated.root, "session-cache", "orphan.json"), old, old);
    expect(await cache.cleanupOrphanCaches()).toBe(1);
    expect(cache.readCache(id)?.model).toBe("fixture");
    expect(cache.readCache("__new_fixture")?.model).toBe("fixture");
  });
  it("recognizes SDK header identity for an imported dotted ID and renamed transcript", async () => {
    const dir = path.join(isolated.root, "agent", "sessions", "imported"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "renamed.jsonl"), JSON.stringify({ type: "session", version: 3, id: "custom.json.session", timestamp: new Date().toISOString(), cwd: "/fixture" }) + "\n");
    cache.writeCache("custom.json.session", { model: "fixture" });
    const old = new Date(Date.now() - 1000);
    fs.utimesSync(path.join(isolated.root, "session-cache", "custom.json.session.json"), old, old);
    expect(await cache.cleanupOrphanCaches()).toBe(0);
    expect(cache.readCache("custom.json.session")?.model).toBe("fixture");
  });
  it("preserves the previous cache when atomic replacement fails", () => {
    cache.writeCache("session", { model: "old" });
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("replacement failed"); });
    expect(() => cache.writeCache("session", { model: "new" })).toThrow("replacement failed");
    rename.mockRestore();
    expect(cache.readCache("session")?.model).toBe("old");
    expect(fs.readdirSync(path.join(isolated.root, "session-cache"))).toEqual(["session.json"]);
  });
  it("retains caches written while asynchronous SDK discovery is in progress", async () => {
    const dir = path.join(isolated.root, "agent", "sessions", "project"); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "fixture.jsonl");
    fs.writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: "fixture", timestamp: new Date().toISOString(), cwd: "/fixture" }) + "\n");
    cache.writeCache("orphan", { model: "old" });
    const old = new Date(Date.now() - 1000); fs.utimesSync(path.join(isolated.root, "session-cache", "orphan.json"), old, old);
    const { getSessionManagerClass } = await import("./pi-sdk"); const SM = await getSessionManagerClass();
    const sessions = await SM.listAll(dir);
    vi.spyOn(SM, "listAll").mockImplementationOnce(async () => {
      cache.writeCache("concurrent", { model: "new" });
      return sessions;
    });
    expect(await cache.cleanupOrphanCaches()).toBe(1);
    expect(cache.readCache("concurrent")?.model).toBe("new");
  });
});
