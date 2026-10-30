/**
 * 磁盘读路径的缓存契约。
 *
 * 拆出 `session-image-stats` 后，图片占用统计完全由它决定。缓存以 mtime 失效——
 * 错了会出现两种坏结果：不失效 = 删了图仍显示占满；过度失效 = 每次打开会话都重解析
 * 整份 jsonl（这正是当初 activateSession 造成的开销）。
 *
 * 这里只验证「该重算时重算、不该重算时复用」，不依赖真实会话文件。
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openCalls = { count: 0 };
let sessionFile = "";

vi.mock("./pi-session", () => ({
  listPiSessions: async () => [{ id: "s1", path: sessionFile }],
}));
vi.mock("./pi-session-dir", () => ({ getPiSessionDir: () => "/tmp/pi-sessions" }));
vi.mock("./pi-sdk", () => ({
  getSessionManagerClass: async () => ({
    open: () => {
      openCalls.count += 1;
      return {
        buildSessionProjection: () => ({
          entries: [{ messages: [] }],
        }),
      };
    },
  }),
}));

import { readSessionImageStats } from "./session-image-stats";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "em-imgstats-"));
  sessionFile = path.join(dir, "session.jsonl");
  writeFileSync(sessionFile, "{}\n");
  openCalls.count = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readSessionImageStats", () => {
  it("同一文件未变化时复用上次解析，不重复打开会话", async () => {
    const cache = new Map();
    const first = await readSessionImageStats("/proj", "s1", cache);
    const second = await readSessionImageStats("/proj", "s1", cache);

    expect(openCalls.count).toBe(1);
    expect(second).toEqual(first);
  });

  it("文件 mtime 变化后必须重算（否则删掉的图仍显示占用）", async () => {
    const cache = new Map();
    await readSessionImageStats("/proj", "s1", cache);

    // 推进 mtime：写一次并在文件系统允许的粒度外等待
    const later = new Date(Date.now() + 2000);
    writeFileSync(sessionFile, "{}\n\n");
    utimesSync(sessionFile, later, later);

    await readSessionImageStats("/proj", "s1", cache);
    expect(openCalls.count).toBe(2);
  });

  it("会话不在列表里时返回 undefined（由调用方降级，不抛）", async () => {
    expect(await readSessionImageStats("/proj", "missing", new Map())).toBeUndefined();
  });

  it("不传缓存时每次都重新解析（无隐式全局状态）", async () => {
    await readSessionImageStats("/proj", "s1");
    await readSessionImageStats("/proj", "s1");
    expect(openCalls.count).toBe(2);
  });
});
