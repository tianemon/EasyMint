/**
 * 删除会话必须把它派出去的子 Agent 记录一起删掉。
 *
 * 子 Agent 的 jsonl 落在 `<会话目录>/<sessionId>/subagents/` 下，而 deleteSession 原先只
 * rmSync 主会话文件。结果是主文件没了、目录还在——实测攒下 13 个无法归属的目录、367 个
 * 子会话、5.7MB，界面上完全看不见，也没法再打开。
 *
 * 这与同一个函数里已经处理的 todos 是同一类问题（注释原话：「否则会话删了、清单永远留着」），
 * 只是漏了这一处。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// 这些值在 mock 工厂里被 async 函数引用，调用时才求值——此时 beforeAll 已经赋好。
let mainFile = "";
let sessionDir = "";

vi.mock("./pi-session", () => ({
  listPiSessions: async () => [{ id: "sess-1", path: mainFile }],
  getPiSessionDir: () => sessionDir,
  tryGetPiSessionDir: () => sessionDir,
}));
vi.mock("./pi-sdk", () => ({ getSessionManagerClass: vi.fn() }));
vi.mock("./ipc-broadcast", () => ({ broadcast: vi.fn() }));

const home = mkdtempSync(path.join(os.tmpdir(), "em-del-home-"));
const project = mkdtempSync(path.join(os.tmpdir(), "em-del-proj-"));
process.env.EASYMINT_HOME = home;

let service: typeof import("./session-service");
let subDir = "";

beforeAll(async () => {
  sessionDir = path.join(project, ".easymint", "sessions");
  mainFile = path.join(sessionDir, "2026-10-30T00-00-00-000Z_sess-1.jsonl");
  subDir = path.join(sessionDir, "sess-1", "subagents");
  mkdirSync(subDir, { recursive: true });
  writeFileSync(mainFile, "{}\n");
  writeFileSync(path.join(subDir, "child-a.jsonl"), "{}\n");
  service = await import("./session-service");
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("deleteSession", () => {
  it("连同子 Agent 目录一起删除，不留无法归属的孤儿", async () => {
    expect(existsSync(subDir)).toBe(true);

    await service.deleteSession("sess-1", project);

    expect(existsSync(mainFile)).toBe(false);
    expect(existsSync(subDir)).toBe(false);
    // 父目录本身留着：同一个项目里可能还有别的会话
    expect(existsSync(sessionDir)).toBe(true);
  });
});
