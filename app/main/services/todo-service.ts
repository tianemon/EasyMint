/**
 * 用户待办服务 — .easymint/todos.json（项目级唯一源）
 *
 * 语义：用户的想法与计划清单（跨会话持久），UI 面板（输入卡片「待办」按钮）与 Mint 共读写。
 * 与 task.json（正式执行任务）、session-todos（Mint 执行追踪）三套清单互不混淆。
 *
 * 历史迁移：docs/待办事项.md 存在且 todos.json 不存在时一次性导入（解析 ## 段标题+全文），
 * 原文档改名「待办事项-归档.md」保留可查——之后 md 不再是数据源。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";

export interface UserTodo {
  id: number;
  title: string;
  /** 补充说明（可空；历史导入 = 原 md 条目全文） */
  note?: string;
  status: "open" | "done";
  createdAt: number;
  doneAt: number | null;
}

export interface TodosFile {
  updatedAt: number;
  todos: UserTodo[];
}

export interface TodoResult<T = unknown> {
  ok: boolean;
  error?: string;
  /** list 时携带：是否刚完成历史迁移 + 导入条数 */
  migrated?: boolean;
  migratedCount?: number;
  data?: T;
}

const EMPTY: TodosFile = { updatedAt: 0, todos: [] };

function todosPath(projectPath: string): string {
  return path.join(projectPath, ".easymint", "todos.json");
}

function legacyMdPath(projectPath: string): string {
  return path.join(projectPath, "docs", "待办事项.md");
}

function readTodos(projectPath: string): TodosFile {
  const p = todosPath(projectPath);
  if (!existsSync(p)) return { ...EMPTY, todos: [] };
  try {
    const data = JSON.parse(readFileSync(p, "utf-8")) as Partial<TodosFile>;
    return {
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
      todos: Array.isArray(data.todos)
        ? (data.todos as UserTodo[]).filter((t) => t && typeof t.id === "number" && typeof t.title === "string")
        : [],
    };
  } catch {
    // 损坏文件不静默覆盖——备份后按空清单处理
    try {
      renameSync(p, `${p}.corrupt-${Date.now()}`);
    } catch { /* 备份失败忽略 */ }
    return { ...EMPTY, todos: [] };
  }
}

function writeTodos(projectPath: string, data: TodosFile): void {
  const p = todosPath(projectPath);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ ...data, updatedAt: Date.now() }, null, 2));
}

/**
 * 历史迁移（幂等）：docs/待办事项.md 存在 && todos.json 不存在 → 解析导入 → md 改名归档。
 * 解析规则：`## N. 标题` 分段；title = 去掉「N. 」编号的标题；note = 该段全文（零丢失）。
 */
export function ensureMigrated(projectPath: string): { migrated: boolean; count: number } {
  const md = legacyMdPath(projectPath);
  const json = todosPath(projectPath);
  if (!existsSync(md) || existsSync(json)) return { migrated: false, count: 0 };
  let raw = "";
  try {
    raw = readFileSync(md, "utf-8");
  } catch {
    return { migrated: false, count: 0 };
  }
  // 按 ## 段切分（跳过文件头非 ## 内容）
  const segments = raw.split(/(?=^## )/m).filter((s) => /^## /.test(s));
  const todos: UserTodo[] = [];
  for (const seg of segments) {
    const titleLine = seg.match(/^##\s+(.+)$/m)?.[1]?.trim();
    if (!titleLine) continue;
    // 去掉「N. 」编号前缀（json id 自管理）
    const title = titleLine.replace(/^\d+\.\s*/, "").trim() || titleLine;
    const now = Date.now();
    todos.push({ id: todos.length + 1, title, note: seg.trim(), status: "open", createdAt: now, doneAt: null });
  }
  writeTodos(projectPath, { updatedAt: Date.now(), todos });
  // 原文档改名归档（保留可查，不再作为数据源）
  try {
    renameSync(md, path.join(path.dirname(md), "待办事项-归档.md"));
  } catch { /* 归档失败不阻断（json 已是源） */ }
  return { migrated: todos.length > 0 || segments.length > 0, count: todos.length };
}

// ── IPC 操作 ─────────────────────────────────────

export function listTodos(projectPath: string): TodoResult<{ todos: UserTodo[]; migrated?: boolean; migratedCount?: number }> {
  const mig = ensureMigrated(projectPath);
  const data = readTodos(projectPath);
  return {
    ok: true,
    data: { todos: data.todos, ...(mig.migrated ? { migrated: true, migratedCount: mig.count } : {}) },
  };
}

export function addTodo(projectPath: string, input: { title: string; note?: string }): TodoResult<UserTodo> {
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "待办内容不能为空" };
  if (title.length > 200) return { ok: false, error: "待办内容超长（≤200 字符）" };
  const data = readTodos(projectPath);
  const id = data.todos.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  const todo: UserTodo = {
    id,
    title,
    note: input.note ? String(input.note).trim().slice(0, 5000) : undefined,
    status: "open",
    createdAt: Date.now(),
    doneAt: null,
  };
  data.todos.push(todo);
  writeTodos(projectPath, data);
  return { ok: true, data: todo };
}

export function updateTodo(projectPath: string, input: { id: number; title?: string; note?: string }): TodoResult<UserTodo> {
  const data = readTodos(projectPath);
  const todo = data.todos.find((t) => t.id === input.id);
  if (!todo) return { ok: false, error: `待办 #${input.id} 不存在` };
  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) return { ok: false, error: "待办内容不能为空" };
    if (title.length > 200) return { ok: false, error: "待办内容超长（≤200 字符）" };
    todo.title = title;
  }
  if (input.note !== undefined) todo.note = String(input.note).trim().slice(0, 5000) || undefined;
  writeTodos(projectPath, data);
  return { ok: true, data: todo };
}

export function toggleTodo(projectPath: string, id: number): TodoResult<UserTodo> {
  const data = readTodos(projectPath);
  const todo = data.todos.find((t) => t.id === id);
  if (!todo) return { ok: false, error: `待办 #${id} 不存在` };
  if (todo.status === "open") {
    todo.status = "done";
    todo.doneAt = Date.now();
  } else {
    todo.status = "open";
    todo.doneAt = null;
  }
  writeTodos(projectPath, data);
  return { ok: true, data: todo };
}

export function removeTodo(projectPath: string, id: number): TodoResult<null> {
  const data = readTodos(projectPath);
  const idx = data.todos.findIndex((t) => t.id === id);
  if (idx === -1) return { ok: false, error: `待办 #${id} 不存在` };
  data.todos.splice(idx, 1);
  writeTodos(projectPath, data);
  return { ok: true };
}
