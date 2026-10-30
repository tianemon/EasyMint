import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sessionDir = "";
vi.mock("./pi-session", () => ({
  listPiSessions: (cwd: string) => SessionManager.list(cwd, sessionDir),
  getPiSessionDir: () => sessionDir,
  tryGetPiSessionDir: () => sessionDir,
}));
vi.mock("./ipc-broadcast", () => ({ broadcast: vi.fn() }));

let root: string;
let project: string;
let service: typeof import("./session-service");
beforeEach(async () => {
  root = path.join(process.cwd(), "temp/tests", `session-delete-${randomUUID()}`);
  project = path.join(root, "project");
  sessionDir = path.join(root, "sessions", "project-a");
  mkdirSync(sessionDir, { recursive: true });
  vi.stubEnv("EASYMINT_HOME", path.join(root, "home"));
  vi.resetModules();
  service = await import("./session-service");
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

function record(id: string): string {
  const file = path.join(sessionDir, "imported.jsonl");
  writeFileSync(file, JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: project }) + "\n");
  return file;
}

describe("deleteSession", () => {
  it("deletes a normal custom-id session and its children while retaining sibling sessions", async () => {
    const id = "custom.session-1", main = record(id);
    const subDir = path.join(sessionDir, id, "subagents");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(path.join(subDir, "child.jsonl"), "{}");
    const sibling = path.join(sessionDir, "sibling.jsonl");
    writeFileSync(sibling, "unrelated");
    await service.deleteSession(id, project);
    expect(existsSync(main)).toBe(false);
    expect(existsSync(subDir)).toBe(false);
    expect(readFileSync(sibling, "utf-8")).toBe("unrelated");
  });

  it.each(["", ".", "..", "../other", "a/b", "a\\b", "unsupported:id"])("rejects unsafe identity %j before changing any record or metadata", async id => {
    const main = record(id);
    expect((await SessionManager.list(project, sessionDir)).map(s => s.id)).toContain(id);
    const sibling = path.join(root, "sessions", "project-b", "other.jsonl");
    mkdirSync(path.dirname(sibling), { recursive: true });
    writeFileSync(sibling, "unrelated");
    const metadata = path.join(root, "home", "session-titles.json");
    mkdirSync(path.dirname(metadata), { recursive: true });
    writeFileSync(metadata, '{"preserve":"unchanged"}');
    await expect(service.deleteSession(id, project)).rejects.toThrow(/Invalid session/);
    expect(existsSync(main)).toBe(true);
    expect(readFileSync(sibling, "utf-8")).toBe("unrelated");
    expect(readFileSync(metadata, "utf-8")).toBe('{"preserve":"unchanged"}');
  });

  it("does not mistake another session file for a custom ID's child directory", async () => {
    const id = "sibling.jsonl", main = record(id);
    const sibling = path.join(sessionDir, id);
    const unrelated = JSON.stringify({ type: "session", version: 3, id: "other-session", timestamp: new Date().toISOString(), cwd: project }) + "\n";
    writeFileSync(sibling, unrelated);
    expect((await SessionManager.list(project, sessionDir)).map(s => s.id)).toEqual(expect.arrayContaining([id, "other-session"]));
    await service.deleteSession(id, project);
    expect(existsSync(main)).toBe(false);
    expect(readFileSync(sibling, "utf-8")).toBe(unrelated);
  });

  it("removes a child-directory symlink without following it to other data", async () => {
    const id = "custom-id", main = record(id);
    const outside = path.join(root, "unrelated");
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "keep"), "safe");
    symlinkSync(outside, path.join(sessionDir, id), process.platform === "win32" ? "junction" : "dir");
    await service.deleteSession(id, project);
    expect(existsSync(main)).toBe(false);
    expect(readFileSync(path.join(outside, "keep"), "utf-8")).toBe("safe");
  });
});
