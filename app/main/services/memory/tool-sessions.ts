/**
 * 跨工具会话的"感知"层（aab 精简内置版）。
 *
 * 只做**发现**：哪个项目最近在别的工具里动过、什么时候。不解析正文 ——
 * 正文解析器跟各工具格式强绑定，搬进来只会分叉；真要看内容时再按需读。
 *
 * 已核实的目录约定（2026-11-16 本机实测）：
 * - codex：~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl
 * - claude：~/.claude/projects/<项目路径把 / 换成 - >/<uuid>.jsonl
 */
import path from "node:path";

export type ToolName = "codex" | "claude";

export interface ToolSessionHit {
  tool: ToolName;
  file: string;
  mtime: number;
}

export interface ToolScanDeps {
  /** 列目录，返回 [{name, isDir}]；不存在返回 null。 */
  listDir(dir: string): Array<{ name: string; isDir: boolean }> | null;
  /** 文件 mtime（毫秒）；失败返回 null。 */
  mtime(file: string): number | null;
}

export interface ToolScanOptions {
  home: string;
  projectPath: string;
  /** 只看最近多少天，默认 14。 */
  days?: number;
  now?: number;
}

/** claude 用路径编码当目录名：/Users/a/b -> -Users-a-b */
export function claudeProjectDir(home: string, projectPath: string): string {
  const encoded = projectPath.replace(/[/\\]+/gu, "-").replace(/^-+/u, "-");
  return path.join(home, ".claude", "projects", encoded);
}

function recentDayDirs(deps: ToolScanDeps, home: string, days: number, now: number): string[] {
  const out: string[] = [];
  const base = path.join(home, ".codex", "sessions");
  const day = 86_400_000;
  for (let offset = 0; offset <= days; offset += 1) {
    const date = new Date(now - offset * day);
    const dir = path.join(
      base,
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
    );
    if (deps.listDir(dir)) out.push(dir);
  }
  return out;
}

/** 列出某项目在 codex/claude 里最近的活动（按 mtime 倒序，最多 5 条）。 */
export function listToolSessions(options: ToolScanOptions, deps: ToolScanDeps): ToolSessionHit[] {
  const days = options.days ?? 14;
  const now = options.now ?? Date.now();
  const hits: ToolSessionHit[] = [];

  for (const dir of recentDayDirs(deps, options.home, days, now)) {
    for (const entry of deps.listDir(dir) ?? []) {
      if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
      const file = path.join(dir, entry.name);
      const mtime = deps.mtime(file);
      if (mtime === null) continue;
      hits.push({ tool: "codex", file, mtime });
    }
  }

  const claudeDir = claudeProjectDir(options.home, options.projectPath);
  for (const entry of deps.listDir(claudeDir) ?? []) {
    if (entry.isDir || !entry.name.endsWith(".jsonl")) continue;
    const file = path.join(claudeDir, entry.name);
    const mtime = deps.mtime(file);
    if (mtime === null) continue;
    hits.push({ tool: "claude", file, mtime });
  }

  return hits.sort((a, b) => b.mtime - a.mtime).slice(0, 5);
}

/** 一句话路标，用于注入；没有任何活动返回 undefined。 */
export function describeToolSessions(hits: ToolSessionHit[], now = Date.now()): string | undefined {
  if (!hits.length) return undefined;
  const parts = hits.map((hit) => {
    const days = Math.max(0, Math.round((now - hit.mtime) / 86_400_000));
    return `${hit.tool} ${days === 0 ? "今天" : `${days} 天前`}`;
  });
  return `其他工具最近动过：${parts.join("、")}`;
}

/** 从一行 JSON 里取出"助手说了什么"；结构不匹配返回 undefined。 */
function assistantText(row: unknown): string | undefined {
  const record = row as { role?: string; content?: unknown; message?: { role?: string; content?: unknown }; payload?: { role?: string; content?: unknown } };
  const holder = record.message ?? record.payload ?? record;
  if (holder?.role !== "assistant") return undefined;
  const content = holder.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts = content
    .map((part) => (part as { text?: unknown })?.text)
    .filter((text): text is string => typeof text === "string" && Boolean(text.trim()));
  return parts.length ? parts.join("\n") : undefined;
}

export interface SessionTail {
  text: string;
  lines: number;
}

/**
 * 按需读取其他工具会话的**最后一段助手结论**（默认不读，只在用户要求时调）。
 * 容忍两种格式：codex 的 payload 包裹与 claude 的 message 包裹。
 */
export function readSessionTail(raw: string, limit = 800): SessionTail | undefined {
  const rows = raw.split("\n").filter((line) => line.trim());
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rows[index]!);
    } catch {
      continue;
    }
    const text = assistantText(parsed);
    if (!text) continue;
    const single = text.replace(/\s+/gu, " ").trim();
    return { text: single.length <= limit ? single : `${single.slice(0, limit - 1)}…`, lines: rows.length };
  }
  return undefined;
}
