import { EventEmitter, getEventListeners } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { executeForeground } from "./tool";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn: mocks.spawn }));
vi.mock("electron", () => ({ app: { isPackaged: false } }));

describe("foreground stdio settlement", () => {
  it("waits for close and retains stdout arriving after exit", async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    mocks.spawn.mockReturnValue(child);
    const updates: string[] = [];
    const { signal } = new AbortController();
    const work = executeForeground({ argv: ["fixture"], env: {} }, process.cwd(), signal, undefined, {}, partial => updates.push(partial.content.map(block => block.text).join("")));
    expect(getEventListeners(signal, "abort")).toHaveLength(1);
    child.emit("exit", 0);
    const state = await Promise.race([work.then(() => "finished"), new Promise<string>(resolve => setTimeout(() => resolve("waiting"), 0))]);
    child.stdout.emit("data", Buffer.from("late stdout"));
    child.emit("close", 0);
    const result = await work;
    expect(state).toBe("waiting");
    expect(updates.join("")).toContain("late stdout");
    expect(result.content[0]?.text).toContain("late stdout");
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  });
  it("releases a failed start only once when close follows error", async () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    mocks.spawn.mockReturnValue(child);
    const release = vi.fn(async () => {});
    const { signal } = new AbortController();
    const failure = executeForeground({ argv: ["fixture"], env: {}, release }, process.cwd(), signal).catch(error => error);
    expect(getEventListeners(signal, "abort")).toHaveLength(1);
    child.emit("error", new Error("failed start"));
    child.emit("close", 1);
    expect((await failure).message).toContain("failed start");
    expect(release).toHaveBeenCalledTimes(1);
    expect(getEventListeners(signal, "abort")).toHaveLength(0);
  });
});
