import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

const fixture = vi.hoisted(() => ({ name: "原标题" }));
vi.mock("./pi-session", () => ({
  listPiSessions: async () => [{
    id: "session-1", path: "/tmp/session-1.jsonl", name: fixture.name,
    created: new Date(0), modified: new Date(0), messageCount: 0,
    firstMessage: "", allMessagesText: "",
  }],
  getPiSessionDir: () => "/tmp",
  tryGetPiSessionDir: () => "/tmp",
}));
vi.mock("./pi-sdk", () => ({ getSessionManagerClass: vi.fn() }));
vi.mock("./ipc-broadcast", () => ({ broadcast: vi.fn() }));

const home = mkdtempSync(path.join(os.tmpdir(), "em-rename-fallback-"));
process.env.EASYMINT_HOME = home;
let service: typeof import("./session-service");
beforeAll(async () => { service = await import("./session-service"); });
afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("活会话改名回退", () => {
  it("原生写入失败时回退标题在重开列表后可见，下一次成功则清除回退", async () => {
    service.setLiveSessionLookup(() => ({ setSessionName: () => { throw new Error("disk write failed"); } }) as never);
    await service.renameSession("session-1", "回退标题", "/tmp");
    expect((await service.listSessions("/tmp"))[0]?.title).toBe("回退标题");

    service.setLiveSessionLookup(() => ({ setSessionName: (name: string) => { fixture.name = name; } }) as never);
    await service.renameSession("session-1", "原生标题", "/tmp");
    expect((await service.listSessions("/tmp"))[0]?.title).toBe("原生标题");
    expect(JSON.parse(readFileSync(path.join(home, "session-titles.json"), "utf-8"))).toEqual({});
  });
});
