/**
 * 会话待办服务 — .easymint/session-todos/<sessionId>.json
 *
 * Mint 执行追踪清单（AI 全自治、用户只读）。
 * 与用户待办（.easymint/todos.json，UI 面板管理）是两套清单：本模块管「本次执行中的步骤追踪」。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

export type SessionTodoStatus = "pending" | "in_progress" | "completed";

export interface SessionTodo {
  content: string;
  status: SessionTodoStatus;
  /** 该项首次进入 in_progress 的时刻（写入时按 content 与上一轮比对补齐，供前端显示当前步骤耗时） */
  startedAt?: number;
  /** 该项正在等用户输入（仅 in_progress 项可标，前端显示「等待你」） */
  waiting?: boolean;
}

export interface SessionTodosFile {
  sessionId: string;
  updatedAt: number;
  todos: SessionTodo[];
}

const MAX_ITEMS = 20;
const MAX_CONTENT = 200;

const STATUS_CN: Record<SessionTodoStatus, string> = { pending: "待办", in_progress: "进行中", completed: "完成" };

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

/**
 * 会话被删除时回收清单文件（调用方：session-service.deleteSession）。
 * 此前删会话不回收它——孤儿文件永久留存（与用户待办/正式任务三套清单并存，日后排查容易误认）。
 * sessionId 末自 IPC，且本函数会拼路径后直接删——先限字符集（真会话 id 是 uuid 形态），
 * 杜绝 `../` 类路径穿越在删除路径上被利用。
 */
export function deleteSessionTodos(projectPath: string, sessionId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return;
  const p = filePath(projectPath, sessionId);
  if (existsSync(p)) rmSync(p, { force: true });
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
  const badWaiting = todos.findIndex((t) => t.waiting === true && t.status !== "in_progress");
  if (badWaiting >= 0) {
    return `第 ${badWaiting + 1} 项「${todos[badWaiting].content}」标了 waiting，但状态是 ${todos[badWaiting].status}——waiting（等用户输入）只能标在 in_progress 项上`;
  }
  return null;
}

/**
 * 只读比对（不改写清单）：把全量替换语义下最容易说错的两种退化变成警告文案，供 todo_write 追加到返回文本。
 * 两类告警都只在真的发生时触发：
 *  ① 同一 content 从 completed 改成非 completed（已完成事实被抹掉）
 *  ② 清单项数变少（丢项）；仅改写措辞、项数不变不报——否则反复误报会让警告失去分量
 */
export function compareSessionTodos(prev: SessionTodo[], next: SessionTodo[]): string[] {
  const warnings: string[] = [];
  const prevByContent = new Map(prev.map((t) => [t.content, t]));
  next.forEach((t, i) => {
    if (prevByContent.get(t.content)?.status === "completed" && t.status !== "completed") {
      warnings.push(`第 ${i + 1} 项「${t.content}」上一轮已完成，本次被改回「${STATUS_CN[t.status]}」——已完成的事实会丢失（这步确实没做完才应改回，否则保持 completed）`);
    }
  });
  const nextContents = new Set(next.map((t) => t.content));
  const missing = prev.filter((t) => !nextContents.has(t.content));
  // 只在清单真的变短时报「丢项」：条目被改写（同一位置换措辞）时 content 对不上但项数不变，
  // 那种情况报「少了 N 项」是误报——反复误报会让模型干脆忽略这条提醒（也许真丢项）
  if (missing.length > 0 && next.length < prev.length) {
    warnings.push(`本次清单比上一轮少了 ${missing.length} 项：${missing.map((t) => t.content).join("、")}（已完成的项应当一并带上，否则用户会以为这些步骤没做过）`);
  }
  return warnings;
}

/**
 * 按 content 与上一轮比对补齐 startedAt：首次进入 in_progress 记此刻，已在进行中/已完成的保留原值。
 * 每次调用都刷新会让耗时永远从 0 开始；completed 保留是为了展开面板能显示「这一步用了几分钟」。
 */
function fillStartedAt(prev: SessionTodo[], todos: SessionTodo[]): SessionTodo[] {
  const prevByContent = new Map(prev.map((t) => [t.content, t]));
  const now = Date.now();
  return todos.map((t) => {
    const old = prevByContent.get(t.content);
    const out: SessionTodo = { ...t };
    if (t.status === "in_progress") {
      out.startedAt = old?.status === "in_progress" && typeof old.startedAt === "number" ? old.startedAt : now;
    } else if (t.status === "completed" && typeof old?.startedAt === "number") {
      out.startedAt = old.startedAt;
    } else {
      delete out.startedAt; // pending 项的时间戳无意义（再次进入 in_progress 时重新计时）
    }
    return out;
  });
}

/** 全量替换写入（校验通过才落盘） */
export function replaceSessionTodos(projectPath: string, sessionId: string, todos: SessionTodo[]): { ok: boolean; error?: string } {
  const err = validateSessionTodos(todos);
  if (err) return { ok: false, error: err };
  writeSessionTodos(projectPath, sessionId, fillStartedAt(readSessionTodos(projectPath, sessionId), todos));
  return { ok: true };
}
