import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundShellRegistry } from "./registry";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn: mocks.spawn }));
vi.mock("../ipc-broadcast", () => ({ broadcast: vi.fn() }));
const roots: string[] = [];
afterEach(async () => {
  backgroundShellRegistry.reset();
  await new Promise(resolve => setTimeout(resolve, 10));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const start = () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  mocks.spawn.mockReturnValue(child);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-bg-quality-")); roots.push(root);
  const release = vi.fn(async () => {}), onExit = vi.fn();
  backgroundShellRegistry.start({ argv: ["fixture"], env: {}, release }, root, onExit, "session");
  return { child, release, onExit };
};
describe("background command output lifetime", () => {
  it("waits for stdio close before completion and includes late output", async () => {
    const { child, release, onExit } = start();
    child.emit("exit", 0);
    const premature = onExit.mock.calls.length;
    child.stdout.emit("data", Buffer.from("last output"));
    child.emit("close", 0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(premature).toBe(0);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit.mock.calls[0]?.[0].output).toContain("last output");
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("settles a failed spawn once even when close arrives afterward", async () => {
    const { child, release, onExit } = start();
    child.emit("error", new Error("fixture unavailable"));
    child.emit("close", -1);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit.mock.calls[0]?.[0].output).toContain("fixture unavailable");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
