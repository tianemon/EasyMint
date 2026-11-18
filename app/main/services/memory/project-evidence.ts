/**
 * 项目证据（工作态）：三源降级采集。
 *
 * 1. git：HEAD、提交数、最近提交；不可用时降级
 * 2. 文件系统：最近修改时间与改动集中目录（无 git 时的主证据）
 * 3. 会话：由调用方提供（本模块不读会话，保持职责单一）
 *
 * 校验信号只用"慢变量"：有 git 时是 HEAD + 提交数，没有时是最新 mtime + 文件数。
 * 未提交改动数变化频繁，只作为证据内容，不参与"是否需要重算"的判断。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface EvidenceProbe {
  /** 直接用参数执行只读 Git 命令，失败返回 null。 */
  runGit(args: string[]): string | null;
  /** 走目录树，返回最新修改时间与文件数（可按实现限制深度与数量）。 */
  walk?(root: string): { latestMtime: number; count: number; topDirs: Array<{ dir: string; count: number }> } | null;
  now?(): number;
}

export interface GitEvidence {
  head: string;
  commits: number;
  dirty: number;
  /** 最后一次提交时间（毫秒），无提交时为 0。 */
  lastCommitAt: number;
  recent: Array<{ date: string; subject: string }>;
}

export interface FileEvidence {
  latestMtime: number;
  count: number;
  topDirs: Array<{ dir: string; count: number }>;
}

export interface ProjectEvidence {
  git?: GitEvidence;
  files?: FileEvidence;
  /** 慢变量校验信号；与上次不同才需要重算进展。 */
  signal: string;
  /** 证据里是否出现了足以重算的新内容（供调用方与"未处理会话"合并判断）。 */
  hasContent: boolean;
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "vendor",
  ".next", ".nuxt", ".cache", ".venv", "__pycache__", "coverage", ".turbo",
]);
const WALK_DEPTH = 3;
const WALK_MAX_ENTRIES = 20_000;

/** 默认目录树遍历：限制深度与条目数，跳过构建产物与依赖目录。 */
export function walkTree(root: string): FileEvidence | null {
  let latestMtime = 0;
  let count = 0;
  let seen = 0;
  const byTop = new Map<string, number>();
  const stack: Array<{ dir: string; depth: number; top: string }> = [{ dir: root, depth: 0, top: "" }];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (seen++ > WALK_MAX_ENTRIES) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current.dir, entry.name);
      const top = current.top || (entry.isDirectory() ? entry.name : "");
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || current.depth + 1 > WALK_DEPTH) continue;
        stack.push({ dir: full, depth: current.depth + 1, top });
        continue;
      }
      if (!entry.isFile()) continue;
      count += 1;
      if (top) byTop.set(top, (byTop.get(top) ?? 0) + 1);
      try {
        const mtime = fs.statSync(full).mtimeMs;
        if (mtime > latestMtime) latestMtime = mtime;
      } catch {
        /* 单个文件读不到不影响整体证据 */
      }
    }
  }
  if (!count) return null;
  const topDirs = [...byTop.entries()]
    .map(([dir, value]) => ({ dir, count: value }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return { latestMtime, count, topDirs };
}

function lines(value: string | null): string[] {
  return (value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function readGit(probe: EvidenceProbe): GitEvidence | undefined {
  const head = probe.runGit(["rev-parse", "--short", "HEAD"]);
  if (!head || !/^[0-9a-f]{4,}$/iu.test(head)) return undefined;
  const count = probe.runGit(["rev-list", "--count", "HEAD"]);
  if (!count || !/^\d+$/u.test(count)) return undefined;
  const recent = lines(probe.runGit(["log", "-5", "--pretty=%ad|%s", "--date=short"])).flatMap((line) => {
    const index = line.indexOf("|");
    return index > 0 ? [{ date: line.slice(0, index), subject: line.slice(index + 1) }] : [];
  });
  const dirty = lines(probe.runGit(["status", "--porcelain"])).length;
  const seconds = Number(probe.runGit(["log", "-1", "--format=%ct"]) ?? "");
  return {
    head,
    commits: Number(count),
    dirty,
    lastCommitAt: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
    recent,
  };
}

/** 用 git 跟踪的文件清单统计改动集中目录：自动排除被 ignore 的临时目录与依赖。 */
function trackedFiles(probe: EvidenceProbe, git: GitEvidence): FileEvidence | undefined {
  const list = lines(probe.runGit(["-c", "core.quotePath=false", "ls-files"]));
  if (!list.length) return undefined;
  const byTop = new Map<string, number>();
  for (const file of list) {
    const top = file.includes("/") ? file.slice(0, file.indexOf("/")) : "(根目录)";
    byTop.set(top, (byTop.get(top) ?? 0) + 1);
  }
  return {
    count: list.length,
    latestMtime: git.lastCommitAt,
    topDirs: [...byTop.entries()]
      .map(([dir, count]) => ({ dir, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
  };
}

export function collectEvidence(root: string, probe: EvidenceProbe): ProjectEvidence {
  const git = readGit(probe);
  // 有 git 时用跟踪文件清单，避免把 temp / node_modules / 浏览器缓存算成"改动集中"。
  const files = (git ? trackedFiles(probe, git) : undefined) ?? (probe.walk ?? walkTree)(root) ?? undefined;
  const signal = git
    ? createHash("sha1").update(`git:${git.head}:${git.commits}`).digest("hex").slice(0, 16)
    : files
      ? createHash("sha1").update(`fs:${files.count}:${files.latestMtime}`).digest("hex").slice(0, 16)
      : createHash("sha1").update("empty").digest("hex").slice(0, 16);
  return { git, files, signal, hasContent: Boolean(git || files) };
}

/** 压缩成给模型看的证据摘要（不含代码正文，只有指针）。 */
export function describeEvidence(evidence: ProjectEvidence): string {
  const out: string[] = [];
  if (evidence.git) {
    const { head, commits, recent } = evidence.git;
    out.push(`git: HEAD ${head}，共 ${commits} 次提交`);
    for (const item of recent) out.push(`  ${item.date} ${item.subject}`);
  } else {
    out.push("git: 无（项目未使用 git 或未安装）");
  }
  if (evidence.files) {
    // 只写绝对日期与慢变量：相对时间会让版本每轮变化，破坏"内容没变不注入"。
    const at = evidence.files.latestMtime ? new Date(evidence.files.latestMtime).toISOString().slice(0, 10) : "未知";
    const dirs = evidence.files.topDirs.map((item) => `${item.dir}(${item.count})`).join("、");
    out.push(`文件: ${evidence.files.count} 个，最后提交 ${at}${dirs ? `，集中 ${dirs}` : ""}`);
  }
  return out.join("\n");
}
