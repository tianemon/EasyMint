/**
 * Session Service — 基于 Pi SessionManager 的会话管理
 *
 * 职责：
 *  - 会话列表 / 设计会话列表
 *  - 会话消息加载
 *  - 重命名 / 删除 / 置顶 / 归档
 *
 * 元数据文件（~/.easymint/）：
 *  - pinned-sessions.json   → { sessionId: timestamp }
 *  - archived-sessions.json  → { sessionId: timestamp }
 *  - session-titles.json     → { sessionId: title }
 *  - session-types.json      → { sessionId: "mint"|"designer" }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveHome } from "../utils/paths";
import { deleteCache } from "./session-cache";
import { listPiSessions, getPiSessionDir } from "./pi-session";
import { getSessionManagerClass } from "./pi-sdk";
import { compactionSummaryNotice } from "../../shared/prompts";
import { deleteSessionTodos } from "./session-todos";

const DATA_DIR = path.join(os.homedir(), ".easymint");
const PINNED_PATH = path.join(DATA_DIR, "pinned-sessions.json");
const ARCHIVED_PATH = path.join(DATA_DIR, "archived-sessions.json");
const TITLES_PATH = path.join(DATA_DIR, "session-titles.json");
const SESSION_TYPES_PATH = path.join(DATA_DIR, "session-types.json");

// ── 类型 ────────────────────────────────────────────

interface SessionListItem {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  lastMessage?: string;
  pinnedAt?: number;
  archivedAt?: number;
  agentType?: string;
}

interface SessionMessage {
  type: "user" | "assistant" | "toolResult";
  uuid: string;
  session_id: string;
  message: unknown;
  parent_tool_use_id: string | null;
  created_at?: number;
}

// ── 工具函数 ────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (existsSync(filePath)) return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch { /* ignore */ }
  return fallback;
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readPinned(): Record<string, number> {
  return readJson(PINNED_PATH, {});
}

function writePinned(data: Record<string, number>): void {
  writeJson(PINNED_PATH, data);
}

function readArchived(): Record<string, number> {
  return readJson(ARCHIVED_PATH, {});
}

function writeArchived(data: Record<string, number>): void {
  writeJson(ARCHIVED_PATH, data);
}

function readTitles(): Record<string, string> {
  return readJson(TITLES_PATH, {});
}

function writeTitles(data: Record<string, string>): void {
  writeJson(TITLES_PATH, data);
}

function readSessionTypes(): Record<string, string> {
  return readJson(SESSION_TYPES_PATH, {});
}

function getDesignSessionIds(): Set<string> {
  const types = readSessionTypes();
  return new Set(
    Object.entries(types)
      .filter(([, type]) => type === "designer")
      .map(([id]) => id)
  );
}

/** Pi SessionInfo → SessionListItem，保留原有接口兼容 */
function toListItem(
  info: { id: string; path: string; name?: string; created: Date; modified: Date; messageCount: number; firstMessage: string; allMessagesText: string },
  pinned: Record<string, number>,
  archived: Record<string, number>,
  titles: Record<string, string>,
): SessionListItem {
  return {
    sessionId: info.id,
    title: info.name || titles[info.id] || info.firstMessage?.slice(0, 30) || "新会话",
    createdAt: info.created.getTime(),
    updatedAt: info.modified.getTime(),
    messageCount: info.messageCount,
    lastMessage: info.allMessagesText?.slice(-100) || "",
    pinnedAt: pinned[info.id] || undefined,
    archivedAt: archived[info.id] || undefined,
  };
}

/** 排序：置顶 > 时间 */
function sortSessions(list: SessionListItem[]): SessionListItem[] {
  return list.sort((a, b) => {
    const ap = a.pinnedAt || 0;
    const bp = b.pinnedAt || 0;
    if (ap && bp) return bp - ap;
    if (ap) return -1;
    if (bp) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

// ── 公开 API ─────────────────────────────────────────

export async function listSessions(projectPath: string): Promise<SessionListItem[]> {
  const resolved = path.resolve(resolveHome(projectPath));
  const sessions = await listPiSessions(resolved);
  const pinned = readPinned();
  const archived = readArchived();
  const titles = readTitles();
  return sortSessions(
    sessions
      .map((s) => toListItem(s, pinned, archived, titles))
  );
}

export async function listDesignSessions(projectPath: string): Promise<SessionListItem[]> {
  const resolved = path.resolve(resolveHome(projectPath));
  const sessions = await listPiSessions(resolved);
  const pinned = readPinned();
  const archived = readArchived();
  const titles = readTitles();
  const designIds = getDesignSessionIds();

  return sortSessions(
    sessions
      .filter((s) => designIds.has(s.id))
      .map((s) => toListItem(s, pinned, archived, titles))
  );
}

export async function getSessionMessages(
  sessionId: string,
  projectPath: string,
): Promise<SessionMessage[]> {
  const resolved = path.resolve(resolveHome(projectPath));
  const sessions = await listPiSessions(resolved);
  const info = sessions.find((s) => s.id === sessionId);
  if (!info) return [];
  try {
    const SM = await getSessionManagerClass();
    const mgr = SM.open(info.path, getPiSessionDir(resolved), resolved);
    // includeToolResult: 主会话历史也带工具结果(前端 mapSessionMessages 按 toolCallId 关联显示)
    return parseEntriesToMessages(mgr, sessionId, true);
  } catch {
    return [];
  }
}

/** 磁盘消息块归一化:Pi 磁盘 jsonl 的 toolCall+arguments → 统一 tool_use+input(保留 id/name/thinking)。
 *  流式路径已在 event-bridge 归一化,此处让磁盘历史与流式格式一致,前端只认一种。 */
function normalizeToolCallBlocks(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((b) => {
    if (typeof b !== "object" || b === null) return b;
    const block = b as Record<string, unknown>;
    if (block.type === "toolCall") {
      const { arguments: args, ...rest } = block;
      return { ...rest, type: "tool_use", input: (block.input as Record<string, unknown>) ?? (args as Record<string, unknown>) };
    }
    return block;
  });
}

/** 取当前分支（leaf 回溯到根）上的条目。
 *  会话文件是 append-only 树：打断撤回会把废弃分支留在文件里（消息+空回复）——
 *  直接读全部条目会把已作废的消息又显示出来，与上下文不一致。 */
function currentBranchEntries(mgr: { getEntries(): unknown[]; getLeafId(): string | null }): unknown[] {
  const all = mgr.getEntries() as Array<{ id: string; parentId?: string | null }>;
  const byId = new Map(all.map((e) => [e.id, e]));
  const leafId = mgr.getLeafId();
  let cur = leafId ? byId.get(leafId) : all[all.length - 1];
  const onPath = new Set<string>();
  while (cur) {
    onPath.add(cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return all.filter((e) => onPath.has(e.id));
}

/** SessionManager entries → SessionMessage[](getSessionMessages / getSubagentMessages 共用)
    includeToolResult: 子 Agent 过程读取需要 toolResult(工具输出),主会话历史不需要 */
async function parseEntriesToMessages(mgr: { getEntries(): unknown[]; getLeafId(): string | null }, sessionId: string, includeToolResult = false): Promise<SessionMessage[]> {
  const entries = currentBranchEntries(mgr) as Array<{
    type: string;
    id: string;
    timestamp: string;
    message?: unknown;
    customType?: string;
    content?: unknown;
    details?: Record<string, unknown>;
  }>;
  const messages: SessionMessage[] = [];
  for (const entry of entries) {
    if (entry.type === "message") {
      const msg = entry.message as unknown as Record<string, unknown>;
      const role = msg.role as string;
      if (role !== "user" && role !== "assistant") {
        if (!(includeToolResult && role === "toolResult")) continue;
      }
      // 磁盘块归一化(toolCall→tool_use)后再透传,前端只认归一化格式
      const outMsg = role === "assistant" && Array.isArray(msg.content)
        ? { ...msg, content: normalizeToolCallBlocks(msg.content) }
        : msg;

      messages.push({
        type: role,
        uuid: entry.id,
        session_id: sessionId,
        message: outMsg,
        parent_tool_use_id: null,
        created_at: (msg.created_at as number) ?? new Date(entry.timestamp).getTime(),
      });
    } else if (entry.type === "custom_message") {
      // 系统消息(customType: system_message):以 user 形态返回,
      // 前端按 customType/details 渲染;customType/details 透传供识别
      const custom = entry as unknown as {
        customType?: string;
        content?: unknown;
        details?: Record<string, unknown>;
        timestamp?: string;
      };
      // 历史注入的摘要卡（details.kind=summary）不再渲染：摘要卡统一从 compaction 条目生成
      // （同一份摘要只显示一张；旧会话里已注入过的那种仍旧留在文件里，但不再重复显示）
      if (custom.details?.kind === "summary") continue;
      messages.push({
        type: "user",
        uuid: entry.id,
        session_id: sessionId,
        message: {
          role: "user",
          content: custom.content ?? [],
          customType: custom.customType,
          details: custom.details,
          timestamp: new Date(custom.timestamp ?? entry.timestamp).getTime(),
        },
        parent_tool_use_id: null,
        created_at: new Date(custom.timestamp ?? entry.timestamp).getTime(),
      });
    } else if (entry.type === "compaction") {
      // 压缩记录 = 模型的上下文记忆，同时也当摘要卡显示（用户在压缩后要看摘要）。
      // 显示这一份而不是另注入一条：注入的那条同样进模型上下文，等于同一份摘要存两遍。
      const comp = entry as unknown as { summary?: string; timestamp?: string };
      const summary = comp.summary?.trim();
      if (summary) {
        const ts = new Date(comp.timestamp ?? entry.timestamp).getTime();
        messages.push({
          type: "user",
          uuid: entry.id,
          session_id: sessionId,
          message: {
            role: "user",
            content: compactionSummaryNotice(summary),
            customType: "system_message",
            details: { kind: "summary" },
            timestamp: ts,
          },
          parent_tool_use_id: null,
          created_at: ts,
        });
      }
    }
  }
  return messages;
}

/** 读取子 Agent 会话消息(前端查看 Agent 过程用)。
 *  sessionFile: 子会话 jsonl 绝对路径(executor 记录,委派进度透传)。
 *  SM.open 只传文件路径——SDK 从文件 header 的 session 条目自动读 cwd/sessionDir,
 *  无需外部传 projectPath(子会话不在 listPiSessions 可见范围)。
 *  会话 ID 从文件名尾段提取(<时间戳>_<sessionId>.jsonl)。 */
export async function getSubagentMessages(sessionFile: string): Promise<SessionMessage[]> {
  if (!sessionFile) return [];
  const sid = path.basename(sessionFile).replace(/\.[^.]+$/, "").split("_").pop() || sessionFile;
  try {
    const SM = await getSessionManagerClass();
    const mgr = SM.open(sessionFile);
    // 子 Agent 过程读取需要 toolResult 消息(工具输出)——主会话历史(getSessionMessages)不需要
    return parseEntriesToMessages(mgr, sid, true);
  } catch {
    return [];
  }
}

export async function getSessionInfo(
  sessionId: string,
  projectPath: string,
): Promise<SessionListItem | null> {
  const resolved = path.resolve(resolveHome(projectPath));
  const sessions = await listPiSessions(resolved);
  const info = sessions.find((s) => s.id === sessionId);
  if (!info) return null;

  const pinned = readPinned();
  const archived = readArchived();
  const titles = readTitles();
  return toListItem(info, pinned, archived, titles);
}

export async function renameSession(
  sessionId: string,
  title: string,
  projectPath: string,
): Promise<void> {
  const resolved = path.resolve(resolveHome(projectPath));
  try {
    const sessions = await listPiSessions(resolved);
    const info = sessions.find((s) => s.id === sessionId);
    if (info) {
      const SM = await getSessionManagerClass();
      const mgr = SM.open(info.path, getPiSessionDir(resolved), resolved);
      mgr.appendSessionInfo(title); // Pi 原生写入 session_info 条目
      return;
    }
  } catch { /* 回退到 metadata 文件 */ }
  // 找不到 Pi session 文件时回退
  const titles = readTitles();
  titles[sessionId] = title;
  writeTitles(titles);
}

export async function deleteSession(
  sessionId: string,
  projectPath: string,
): Promise<void> {
  const resolved = path.resolve(resolveHome(projectPath));
  const sessions = await listPiSessions(resolved);
  const info = sessions.find((s) => s.id === sessionId);
  if (info) {
    // 删除 Pi 会话文件
    if (existsSync(info.path)) {
      rmSync(info.path, { force: true });
    }
    // 清理 pin/archive/title 记录
    const pinned = readPinned();
    delete pinned[sessionId];
    writePinned(pinned);
    const archived = readArchived();
    delete archived[sessionId];
    writeArchived(archived);
    const titles = readTitles();
    delete titles[sessionId];
    writeTitles(titles);
    // 清理缓存
    deleteCache(sessionId);
    // 清理本会话的执行步骤清单（.easymint/session-todos/<id>.json）——否则会话删了、清单永远留着
    deleteSessionTodos(resolved, sessionId);
  }
}

export function togglePin(id: string): boolean {
  const pinned = readPinned();
  let nowPinned: boolean;
  if (pinned[id]) {
    delete pinned[id];
    nowPinned = false;
  } else {
    pinned[id] = Date.now();
    nowPinned = true;
  }
  writePinned(pinned);
  return nowPinned;
}

export function archiveSession(sessionId: string): void {
  const archived = readArchived();
  archived[sessionId] = Date.now();
  writeArchived(archived);
  const pinned = readPinned();
  delete pinned[sessionId];
  writePinned(pinned);
}

export function unarchiveSession(sessionId: string): void {
  const archived = readArchived();
  delete archived[sessionId];
  writeArchived(archived);
}

export async function hasCustomTitle(sessionId: string, projectPath?: string): Promise<boolean> {
  // 检查 Pi 原生 session_info 条目
  const titles = readTitles();
  if (sessionId in titles) return true;
  // 检查 Pi SessionInfo.name（来自 session_info 条目）
  if (projectPath) {
    const resolved = path.resolve(resolveHome(projectPath));
    try {
      const sessions = await listPiSessions(resolved);
      const info = sessions.find((s) => s.id === sessionId);
      if (info?.name) return true;
    } catch { /* ignore */ }
  }
  return false;
}

/** 收集项目会话目录中所有 sessionId，清理对应元数据（cache/pinned/archived/titles），返回 sid 列表。
 *  供删除项目时调用；会话目录本身由调用方移废纸篓，session-types 由 agent-service 的 removeSessionTypes 清理。 */
export function cleanupProjectSessions(projectPath: string): string[] {
  const resolved = path.resolve(resolveHome(projectPath));
  const sessionDir = getPiSessionDir(resolved);
  if (!existsSync(sessionDir)) return [];

  const sids = new Set<string>();
  const collect = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(p);
      else if (entry.name.endsWith(".jsonl")) {
        const m = entry.name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
        if (m) sids.add(m[0]);
      }
    }
  };
  collect(sessionDir);

  const list = [...sids];
  for (const sid of list) deleteCache(sid);

  const pinned = readPinned();
  const archived = readArchived();
  const titles = readTitles();
  let changed = false;
  for (const sid of list) {
    if (sid in pinned) { delete pinned[sid]; changed = true; }
    if (sid in archived) { delete archived[sid]; changed = true; }
    if (sid in titles) { delete titles[sid]; changed = true; }
  }
  if (changed) {
    writePinned(pinned);
    writeArchived(archived);
    writeTitles(titles);
  }
  return list;
}
