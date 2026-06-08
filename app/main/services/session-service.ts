/**
 * Session Service — thin wrapper around SDK session APIs.
 *
 * SDK handles all session storage and lifecycle. We only add:
 *   - pinned status (~/.easymint/pinned-sessions.json)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SDKSessionInfo, SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { deleteCache } from "./session-cache";

const DATA_DIR = path.join(os.homedir(), ".easymint");
const PINNED_PATH = path.join(DATA_DIR, "pinned-sessions.json");
const ARCHIVED_PATH = path.join(DATA_DIR, "archived-sessions.json");

/** Normalize a directory path for SDK session APIs — expand ~, resolve to absolute, strip trailing slash, use forward slashes. */
function normalizeDir(dir: string): string {
  let resolved = dir.startsWith("~") ? path.join(os.homedir(), dir.slice(1)) : dir;
  resolved = path.resolve(resolved);
  return resolved.replace(/\\/g, "/");
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

// ── Pinned storage ─────────────────────────────────

function readPinned(): Record<string, number> {
  if (!existsSync(PINNED_PATH)) return {};
  try { return JSON.parse(readFileSync(PINNED_PATH, "utf-8")); } catch { return {}; }
}

function writePinned(data: Record<string, number>): void {
  ensureDir();
  writeFileSync(PINNED_PATH, JSON.stringify(data, null, 2));
}

function readArchived(): Record<string, number> {
  if (!existsSync(ARCHIVED_PATH)) return {};
  try { return JSON.parse(readFileSync(ARCHIVED_PATH, "utf-8")); } catch { return {}; }
}

function writeArchived(data: Record<string, number>): void {
  ensureDir();
  writeFileSync(ARCHIVED_PATH, JSON.stringify(data, null, 2));
}

// ── SDK wrappers ───────────────────────────────────

type ListSessionsFn = typeof import("@anthropic-ai/claude-agent-sdk").listSessions;
type GetSessionMessagesFn = typeof import("@anthropic-ai/claude-agent-sdk").getSessionMessages;
type RenameSessionFn = typeof import("@anthropic-ai/claude-agent-sdk").renameSession;
type DeleteSessionFn = typeof import("@anthropic-ai/claude-agent-sdk").deleteSession;
type GetSessionInfoFn = typeof import("@anthropic-ai/claude-agent-sdk").getSessionInfo;

let _listSessions: ListSessionsFn | null = null;
let _getSessionMessages: GetSessionMessagesFn | null = null;
let _renameSession: RenameSessionFn | null = null;
let _deleteSession: DeleteSessionFn | null = null;
let _getSessionInfo: GetSessionInfoFn | null = null;

async function sdk() {
  if (!_listSessions) {
    const m = await import("@anthropic-ai/claude-agent-sdk");
    _listSessions = m.listSessions;
    _getSessionMessages = m.getSessionMessages;
    _renameSession = m.renameSession;
    _deleteSession = m.deleteSession;
    _getSessionInfo = m.getSessionInfo;
  }
  return { listSessions: _listSessions!, getSessionMessages: _getSessionMessages!, renameSession: _renameSession!, deleteSession: _deleteSession!, getSessionInfo: _getSessionInfo! };
}

export interface SessionListItem {
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinnedAt?: number;
  archivedAt?: number;
}

import { appendFileSync } from "node:fs";
const DL = path.join(os.homedir(), ".easymint", "easymint.log");
function sdlog(msg: string) { try { appendFileSync(DL, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ } }

export async function listSessions(projectPath: string): Promise<SessionListItem[]> {
  const { listSessions: ls } = await sdk();
  const normalized = normalizeDir(projectPath);
  sdlog("[listSessions] " + normalized);
  const sessions = await ls({ dir: normalized });
  sdlog("[listSessions] OK " + sessions.length);
  const pinned = readPinned();
  const archived = readArchived();

  return sessions
    .map((s: SDKSessionInfo) => ({
      sessionId: s.sessionId,
      title: s.customTitle || s.summary || s.firstPrompt || "新会话",
      createdAt: s.createdAt ?? s.lastModified,
      updatedAt: s.lastModified,
      pinnedAt: pinned[s.sessionId] || undefined,
      archivedAt: archived[s.sessionId] || undefined,
    }))
    .sort((a, b) => {
      const ap = a.pinnedAt || 0;
      const bp = b.pinnedAt || 0;
      if (ap && bp) return bp - ap;
      if (ap) return -1;
      if (bp) return 1;
      return b.updatedAt - a.updatedAt;
    });
}

export async function getSessionMessages(sessionId: string, projectPath: string): Promise<SessionMessage[]> {
  const { getSessionMessages: gsm } = await sdk();
  return gsm(sessionId, { dir: normalizeDir(projectPath) });
}

export async function renameSession(sessionId: string, title: string, projectPath: string): Promise<void> {
  const { renameSession: rs } = await sdk();
  await rs(sessionId, title, { dir: normalizeDir(projectPath) });
}

export async function deleteSession(sessionId: string, projectPath: string): Promise<void> {
  const { deleteSession: ds } = await sdk();
  await ds(sessionId, { dir: normalizeDir(projectPath) });
  const pinned = readPinned();
  delete pinned[sessionId];
  writePinned(pinned);
  deleteCache(sessionId);
}

export async function getSessionInfo(sessionId: string, projectPath: string): Promise<SessionListItem | null> {
  const { getSessionInfo: gsi } = await sdk();
  const info = await gsi(sessionId, { dir: normalizeDir(projectPath) });
  if (!info) return null;
  const pinned = readPinned();
  return {
    sessionId: info.sessionId,
    title: info.customTitle || info.summary || info.firstPrompt || "新会话",
    createdAt: info.createdAt ?? info.lastModified,
    updatedAt: info.lastModified,
    pinnedAt: pinned[info.sessionId] || undefined,
  };
}

export function togglePin(sessionId: string): boolean {
  const pinned = readPinned();
  const currently = !!pinned[sessionId];
  if (currently) {
    delete pinned[sessionId];
  } else {
    pinned[sessionId] = Date.now();
  }
  writePinned(pinned);
  return !currently;
}

/** Archive a session — marks it with a timestamp. Archived sessions get a clock icon. */
export function archiveSession(sessionId: string): void {
  const archived = readArchived();
  archived[sessionId] = Date.now();
  writeArchived(archived);
}

/** Unarchive — remove from archive list (back to normal active state). */
export function unarchiveSession(sessionId: string): void {
  const archived = readArchived();
  delete archived[sessionId];
  writeArchived(archived);
}
