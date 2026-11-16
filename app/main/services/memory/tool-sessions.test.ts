import path from "node:path";
import { expect, it } from "vitest";
import {
  claudeProjectDir,
  describeToolSessions,
  listToolSessions,
  readSessionTail,
  type ToolScanDeps,
} from "./tool-sessions";

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const DAY = 86_400_000;

function deps(tree: Record<string, string[]>, times: Record<string, number>): ToolScanDeps {
  return {
    listDir: (dir) =>
      tree[dir] ? tree[dir]!.map((name) => ({ name, isDir: false })) : null,
    mtime: (file) => (file in times ? times[file]! : null),
  };
}

it("claude 用路径编码作目录名", () => {
  expect(claudeProjectDir("/home/me", "/Users/amon/dev/project/EasyMint")).toBe(
    "/home/me/.claude/projects/-Users-amon-dev-project-EasyMint",
  );
});

it("按日期目录扫描 codex 会话，只取最近 N 天", () => {
  const today = path.join("/h/.codex/sessions/2026/11/16");
  const yesterday = path.join("/h/.codex/sessions/2026/11/15");
  const probe = deps(
    { [today]: ["rollout-a.jsonl"], [yesterday]: ["rollout-b.jsonl", "readme.txt"] },
    {
      [`${today}/rollout-a.jsonl`]: NOW - 1000,
      [`${yesterday}/rollout-b.jsonl`]: NOW - DAY,
    },
  );
  const hits = listToolSessions({ home: "/h", projectPath: "/p", days: 2, now: NOW }, probe);
  expect(hits.map((hit) => hit.tool)).toEqual(["codex", "codex"]);
  expect(hits[0]!.file).toContain("2026/11/16");
  expect(hits.every((hit) => hit.file.endsWith(".jsonl"))).toBe(true);
});

it("同时收集 claude 的项目目录，并按时间倒序取前 5 条", () => {
  const dir = claudeProjectDir("/h", "/p/x");
  const probe = deps(
    { [dir]: ["s1.jsonl", "s2.jsonl"] },
    { [`${dir}/s1.jsonl`]: NOW - 2 * DAY, [`${dir}/s2.jsonl`]: NOW - 3 * 3600_000 },
  );
  const hits = listToolSessions({ home: "/h", projectPath: "/p/x", days: 1, now: NOW }, probe);
  expect(hits.map((hit) => hit.tool)).toEqual(["claude", "claude"]);
  expect(hits[0]!.file).toContain("s2.jsonl");
});

it("目录不存在时返回空，不抛错", () => {
  expect(listToolSessions({ home: "/h", projectPath: "/p", days: 3, now: NOW }, deps({}, {}))).toEqual([]);
  expect(describeToolSessions([])).toBeUndefined();
});

it("渲染成一句话路标，带相对时间", () => {
  const text = describeToolSessions(
    [
      { tool: "codex", file: "a", mtime: NOW - 3600_000 },
      { tool: "claude", file: "b", mtime: NOW - 2 * DAY },
    ],
  );
  expect(text).toBe("其他工具最近动过：codex 11-16、claude 11-14");
});

it("按需读取其他工具会话的最后一段助手结论（codex 格式）", () => {
  const raw = [
    JSON.stringify({ type: "session_meta", payload: { id: "x" } }),
    JSON.stringify({ type: "response_item", payload: { role: "user", content: [{ text: "把注入改到尾部" }] } }),
    JSON.stringify({ type: "response_item", payload: { role: "assistant", content: [{ text: "已改成尾部增量" }] } }),
  ].join("\n");
  expect(readSessionTail(raw)).toEqual({ text: "已改成尾部增量", lines: 3 });
});

it("claude 格式同样能读，且取最后一条助手消息", () => {
  const raw = [
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "问题" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "第一版" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "最终结论" }] } }),
  ].join("\n");
  expect(readSessionTail(raw)?.text).toBe("最终结论");
});

it("没有助手消息时返回 undefined，不抛错", () => {
  expect(readSessionTail("not json\n{}")).toBeUndefined();
});
