/**
 * 会话待办服务 — .easymint/session-todos/<sessionId>.json
 *
 * Mint 执行追踪清单（AI 全自治、用户只读——见 docs/design/会话待办功能设计方案.md）。
 * 与用户待办（.easymint/todos.json，UI 面板管理）是两套清单：本模块管「本次执行中的步骤追踪」。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type SessionTodoStatus = "pending" | "in_progress" | "completed";

export interface SessionTodo {
  content: string;
  status: SessionTodoStatus;
}

export interface SessionTodosFile {
  sessionId: string;
  updatedAt: number;
  todos: SessionTodo[];
}

const MAX_ITEMS = 20;
const MAX_CONTENT = 200;

function filePath(projectPath: string, sessionId: string): string {
  return path.join(projectPath, ".easymint", "session-todos", `${sessionId}.json`);
}

export function readSessionTodos(projectPath: string, sessionId: string): SessionTodo[] {
  const p = filePath(projectPath, sessionId);
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, "utf-8")) as Partial<SessionTodosFile>;
    if (Array.isArray(data.todos)) {
      return data.todos.filter(
        (t): t is SessionTodo => !!t && typeof t.content === "string" && ["pending", "in_progress", "completed"].includes(t.status),
      );
    }
    return [];
  } catch {
    return []; // 损坏按空清单（执行步骤可丢弃重建，非用户数据）
  }
}

function writeSessionTodos(projectPath: string, sessionId: string, todos: SessionTodo[]): void {
  const p = filePath(projectPath, sessionId);
  mkdirSync(path.dirname(p), { recursive: true });
  const data: SessionTodosFile = { sessionId, updatedAt: Date.now(), todos };
  writeFileSync(p, JSON.stringify(data, null, 2));
}

/** 校验（设计文档 §2 execute 内强制）——返回错误文案或 null */
export function validateSessionTodos(todos: SessionTodo[]): string | null {
  if (!Array.isArray(todos)) return "todos 必须是数组";
  if (todos.length < 1) return "待办至少 1 项";
  if (todos.length > MAX_ITEMS) return `待办最多 ${MAX_ITEMS} 项（当前 ${todos.length}）`;
  for (const t of todos) {
    if (!t || typeof t.content !== "string" || !t.content.trim()) return "每项 content 不能为空";
    if (t.content.length > MAX_CONTENT) return `content 超长（≤${MAX_CONTENT} 字符）`;
    if (!["pending", "in_progress", "completed"].includes(t.status)) return `status 非法：${t.status}`;
  }
  const inProgress = todos.filter((t) => t.status === "in_progress").length;
  if (inProgress > 1) return "至多 1 项 in_progress（当前焦点唯一）";
  return null;
}

/** 全量替换写入（校验通过才落盘） */
export function replaceSessionTodos(projectPath: string, sessionId: string, todos: SessionTodo[]): { ok: boolean; error?: string } {
  const err = validateSessionTodos(todos);
  if (err) return { ok: false, error: err };
  writeSessionTodos(projectPath, sessionId, todos);
  return { ok: true };
}
