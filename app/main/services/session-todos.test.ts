/**
 * 会话待办校验规则单测（todo_write 全量替换语义）。
 */
import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareSessionTodos,
  deleteSessionTodos,
  readSessionTodos,
  replaceSessionTodos,
  validateSessionTodos,
  type SessionTodo,
} from "./session-todos";

describe("validateSessionTodos（todo_write 校验）", () => {
  it("合法清单通过（多项 + 单 in_progress）", () => {
    expect(validateSessionTodos([
      { content: "核实 task.json 真实进度", status: "completed" },
      { content: "委派 Builder 实现 id=3", status: "in_progress" },
      { content: "Evaluator 验收 id=3", status: "pending" },
    ])).toBeNull();
  });
  it("空数组拒绝（至少 1 项）", () => {
    expect(validateSessionTodos([])).toContain("至少 1 项");
  });
  it("超过 20 项拒绝", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ content: `步骤 ${i}`, status: "pending" as const }));
    expect(validateSessionTodos(many)).toContain("最多 20 项");
  });
  it("空 content 拒绝", () => {
    expect(validateSessionTodos([{ content: "  ", status: "pending" }])).toContain("不能为空");
  });
  it("content 超长（>200）拒绝", () => {
    expect(validateSessionTodos([{ content: "长".repeat(201), status: "pending" }])).toContain("超长");
  });
  it("非法 status 拒绝", () => {
    expect(validateSessionTodos([{ content: "x", status: "doing" as never }])).toContain("status 非法");
  });
  it("多个 in_progress 拒绝（当前焦点唯一）", () => {
    expect(validateSessionTodos([
      { content: "a", status: "in_progress" },
      { content: "b", status: "in_progress" },
    ])).toContain("至多 1 项");
  });
  it("waiting 标在 in_progress 项上通过", () => {
    expect(validateSessionTodos([{ content: "等你确认方案", status: "in_progress", waiting: true }])).toBeNull();
  });
  it("waiting 标在 pending/completed 项上拒绝（带位置与原因）", () => {
    const pendingErr = validateSessionTodos([{ content: "a", status: "pending", waiting: true }]);
    expect(pendingErr).toContain("waiting");
    expect(pendingErr).toContain("第 1 项");
    const completedErr = validateSessionTodos([
      { content: "a", status: "completed" },
      { content: "b", status: "pending", waiting: true },
    ]);
    expect(completedErr).toContain("第 2 项");
  });
  it("waiting: false 出现在非 in_progress 项上不报错（模型显式写 false 属正常）", () => {
    expect(validateSessionTodos([{ content: "a", status: "completed", waiting: false }])).toBeNull();
  });
});

describe("compareSessionTodos（只读比对警告）", () => {
  it("已完成被改回 in_progress → 命中，带位置与内容", () => {
    const w = compareSessionTodos(
      [{ content: "写记录", status: "completed" }, { content: "提交", status: "pending" }],
      [{ content: "写记录", status: "in_progress" }, { content: "提交", status: "pending" }],
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("第 1 项");
    expect(w[0]).toContain("写记录");
    expect(w[0]).toContain("已完成的事实会丢失");
  });
  it("已完成被改回 pending → 命中", () => {
    const w = compareSessionTodos(
      [{ content: "写记录", status: "completed" }],
      [{ content: "写记录", status: "pending" }],
    );
    expect(w.some((x) => x.includes("从已完成被改回") || x.includes("上一轮已完成"))).toBe(true);
  });
  it("丢项 → 命中，列出少了哪几项", () => {
    const w = compareSessionTodos(
      [{ content: "a", status: "completed" }, { content: "b", status: "completed" }, { content: "c", status: "pending" }],
      [{ content: "c", status: "pending" }],
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("少了 2 项");
    expect(w[0]).toContain("a、b");
  });
  it("不误报：正常推进（pending→in_progress→completed）", () => {
    const prev: SessionTodo[] = [{ content: "a", status: "pending" }, { content: "b", status: "pending" }];
    expect(compareSessionTodos(prev, [{ content: "a", status: "in_progress" }, { content: "b", status: "pending" }])).toEqual([]);
    expect(compareSessionTodos(
      [{ content: "a", status: "in_progress" }, { content: "b", status: "pending" }],
      [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }],
    )).toEqual([]);
  });
  it("不误报：重新提交同一份全量清单 / 新增项 / 重排", () => {
    const prev: SessionTodo[] = [{ content: "a", status: "completed" }, { content: "b", status: "in_progress" }];
    expect(compareSessionTodos(prev, [...prev])).toEqual([]);
    expect(compareSessionTodos(prev, [...prev, { content: "c", status: "pending" }])).toEqual([]);
    expect(compareSessionTodos(prev, [{ content: "b", status: "in_progress" }, { content: "a", status: "completed" }])).toEqual([]);
  });
  it("不误报：条目改写措辞（项数不变）", () => {
    const w = compareSessionTodos(
      [{ content: "验收 id=3", status: "completed" }, { content: "写记录", status: "pending" }],
      [{ content: "验收 id=3（含 UI 验证）", status: "completed" }, { content: "写记录", status: "completed" }],
    );
    expect(w).toEqual([]);
  });
  it("不误报：首次建单（上一轮为空）", () => {
    expect(compareSessionTodos([], [{ content: "a", status: "in_progress" }])).toEqual([]);
  });
});

describe("replaceSessionTodos（startedAt 补齐与保留）", () => {
  let dir = "";
  const sessionId = "sess-started-at";

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    const root = path.join(process.cwd(), "temp", "tests");
    mkdirSync(root, { recursive: true });
    dir = mkdtempSync(path.join(root, "session-todos-"));
  });
  afterAll(() => {
    vi.useRealTimers();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("首次进入 in_progress 记当时刻；已在进行中不被刷新；completed 保留原值", () => {
    const t0 = Date.now();
    expect(replaceSessionTodos(dir, sessionId, [
      { content: "步骤一", status: "in_progress" },
      { content: "步骤二", status: "pending" },
    ]).ok).toBe(true);
    let todos = readSessionTodos(dir, sessionId);
    expect(todos[0].startedAt).toBe(t0);
    expect(todos[1].startedAt).toBeUndefined();

    // 60s 后重复提交同一份（仍为 in_progress）：耗时不归零
    vi.setSystemTime(t0 + 60_000);
    expect(replaceSessionTodos(dir, sessionId, [
      { content: "步骤一", status: "in_progress" },
      { content: "步骤二", status: "pending" },
    ]).ok).toBe(true);
    todos = readSessionTodos(dir, sessionId);
    expect(todos[0].startedAt).toBe(t0);

    // 完成后保留 startedAt（展开面板显示「这一步用了几分钟」）
    vi.setSystemTime(t0 + 180_000);
    expect(replaceSessionTodos(dir, sessionId, [
      { content: "步骤一", status: "completed" },
      { content: "步骤二", status: "in_progress" },
    ]).ok).toBe(true);
    todos = readSessionTodos(dir, sessionId);
    expect(todos[0].startedAt).toBe(t0);
    expect(todos[1].startedAt).toBe(t0 + 180_000); // 新进入 in_progress 的项从此刻起算
  });

  it("waiting 透传落盘", () => {
    expect(replaceSessionTodos(dir, sessionId, [
      { content: "等你确认", status: "in_progress", waiting: true },
    ]).ok).toBe(true);
    expect(readSessionTodos(dir, sessionId)[0].waiting).toBe(true);
  });

  it("校验失败不落盘（waiting 标错状态被拒）", () => {
    const before = readSessionTodos(dir, sessionId);
    const r = replaceSessionTodos(dir, sessionId, [{ content: "x", status: "completed", waiting: true }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("waiting");
    expect(readSessionTodos(dir, sessionId)).toEqual(before);
  });
});

describe("deleteSessionTodos（删会话回收清单文件）", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "session-todos-del-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("清掉该会话的清单文件", () => {
    const sid = "01a0abc0-1111-7222-8333-444455556666";
    replaceSessionTodos(dir, sid, [{ content: "跑一步", status: "completed" }]);
    expect(readSessionTodos(dir, sid)).toHaveLength(1);
    deleteSessionTodos(dir, sid);
    expect(readSessionTodos(dir, sid)).toEqual([]); // 文件没了 → 读回空
    expect(existsSync(path.join(dir, ".easymint", "session-todos", `${sid}.json`))).toBe(false);
  });

  it("文件不存在时安全 no-op（不抛、不影响其他会话）", () => {
    const sid = "01a0abc0-9999-7222-8333-444455556666";
    const other = "01a0abc0-2222-7222-8333-444455556666";
    replaceSessionTodos(dir, other, [{ content: "别人的清单", status: "completed" }]);
    expect(() => deleteSessionTodos(dir, sid)).not.toThrow();
    expect(readSessionTodos(dir, other)).toHaveLength(1);
  });

  it("拒绝路径穿越形态的 id（删除路径上的护栏）", () => {
    // 哨兵：若函数真的拼路径删，它会落在 session-todos 目录之外
    const evil = "../../../sentinel";
    const sentinel = path.resolve(dir, "sentinel.json");
    writeFileSync(sentinel, "should survive");
    deleteSessionTodos(dir, evil);
    expect(existsSync(sentinel)).toBe(true); // 没被删 = 函数在字符集校验处直接返回
    rmSync(sentinel, { force: true });
  });
});
