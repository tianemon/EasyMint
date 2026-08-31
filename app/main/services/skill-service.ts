/**
 * Skill Service — scan, import, delete, toggle, managed writes.
 *
 * Skills are stored as folders with SKILL.md inside (four sources):
 *   Builtin:  resources/skills/                (EM 打包内置)
 *   Authored: ~/.easymint/skills/、<project>/.easymint/skills/  (用户手写/导入)
 *   Managed:  ~/.easymint/managed-skills/      (AI 产物，manage_skill/learn 写入)
 *
 * 与 Claude Code 解耦:EM 用独立目录,不再读写 ~/.claude/skills/。
 * EasyMint maintains its own disabled-skills list in em-settings.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, cpSync, lstatSync, rmSync, unlinkSync, renameSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getResourcesDir } from "../utils/paths";

// ── Types ──────────────────────────────────────────

export interface SkillManifest {
  name: string;
  description: string;
  path: string;
  level: "builtin" | "global" | "project";     // 磁盘位置
  source: "builtin" | "authored" | "imported" | "managed"; // 写入者
  enabled: boolean;
  managedRoot?: string;                         // managed 专属
  shadowed?: boolean;                           // managed 被同名 authored/builtin 遮蔽
  /** imported 专属：来源平台（claude / codex / github），用于界面徽章 */
  importedFrom?: string;
}

export interface SkillDetail extends SkillManifest {
  body: string;
  /** frontmatter 可选字段：加载该 skill 时切换到指定模型（当前供应商下解析，不存在则忽略） */
  model?: string;
}

export interface ManagedSkillInput {
  action: "create" | "update" | "delete";
  name: string;
  description?: string;
  body?: string;
}

export interface ManagedSkillResult {
  ok: boolean;
  error?: string;
  shadowed?: boolean;
}

// ── Constants ──────────────────────────────────────

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), ".easymint", "skills");

// AI 产物区（manage_skill/learn 工具写入），与用户手写区物理隔离
const MANAGED_SKILLS_DIR = path.join(os.homedir(), ".easymint", "managed-skills");

function projectSkillsDir(projectPath: string): string {
  return path.join(projectPath, ".easymint", "skills");
}

// ── Disabled skills list ───────────────────────────

const DISABLED_FILE = path.join(os.homedir(), ".easymint", "em-settings.json");

function getHiddenSkills(): string[] {
  if (!existsSync(DISABLED_FILE)) return [];
  try {
    const data = JSON.parse(readFileSync(DISABLED_FILE, "utf-8"));
    const list = data.hiddenSkills;
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : [];
  } catch (e) {
    // 设置文件损坏按未隐藏处理（skill 全量展示），不阻塞扫描
    console.warn("[skill] hiddenSkills 读取失败（按未隐藏处理）:", (e as Error).message);
    return [];
  }
}

function saveHiddenSkills(list: string[]): void {
  const dir = path.dirname(DISABLED_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data: Record<string, unknown> = {};
  if (existsSync(DISABLED_FILE)) {
    Object.assign(data, JSON.parse(readFileSync(DISABLED_FILE, "utf-8")));
  }
  data.hiddenSkills = list;
  writeFileSync(DISABLED_FILE, JSON.stringify(data, null, 2));
}

// ── 外部生态目录发现（imported 来源，对齐 oh-my-pi 的多 provider 思路） ────
// 只读发现：用户装过 Claude Code / Codex 生态的 skill、或项目带 GitHub Agent Skills
// 标准布局的 .github/skills/，EM 直接可用——零安装动作。优先级低于 EM authored 区。
interface ExternalSkillSource {
  resolve: (projectPath: string) => string;
  level: "global" | "project";
  /** 平台标识（界面徽章） */
  platform: "claude" | "codex" | "github";
}

const EXTERNAL_SOURCES: ExternalSkillSource[] = [
  { resolve: () => path.join(os.homedir(), ".claude", "skills"), level: "global", platform: "claude" },
  { resolve: () => path.join(os.homedir(), ".codex", "skills"), level: "global", platform: "codex" },
  { resolve: (p) => path.join(p, ".claude", "skills"), level: "project", platform: "claude" },
  { resolve: (p) => path.join(p, ".github", "skills"), level: "project", platform: "github" },
];

/** 是否发现外部生态目录（默认开启——只读发现不写文件；关闭后仅用 EM 目录） */
function isExternalDiscoveryEnabled(): boolean {
  if (!existsSync(DISABLED_FILE)) return true;
  try {
    const data = JSON.parse(readFileSync(DISABLED_FILE, "utf-8")) as Record<string, unknown>;
    return data.importExternalSkills !== false;
  } catch {
    return true;
  }
}

// ── YAML frontmatter parser ────────────────────────

function parseFrontmatter(content: string): { name?: string; description?: string; model?: string; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    // No frontmatter — treat entire file as body
    return { body: content };
  }
  const yamlBlock = match[1]!;
  const body = match[2]!;

  // Minimal YAML parser: handles single-line key:value and block scalars (>- |)
  const fields: Record<string, string> = {};
  const lines = yamlBlock.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Block scalar: key: >-  or  key: |  (multi-line value follows, indented)
    const blockMatch = line.match(/^(\w[\w-]*)\s*:\s*([|>][-]?)\s*$/);
    if (blockMatch) {
      const key = blockMatch[1]!;
      const style = blockMatch[2]!; // >, >-, |, |-
      const valueLines: string[] = [];
      while (i + 1 < lines.length && /^\s{2,}/.test(lines[i + 1]!)) {
        i++;
        valueLines.push(lines[i]!.trim());
      }
      fields[key] = style.startsWith(">")
        ? valueLines.join(" ")   // folded: join with spaces
        : valueLines.join("\n"); // literal: keep newlines
      continue;
    }

    // Single-line key: value
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (kv) {
      fields[kv[1]!] = kv[2]!.trim();
    }
  }

  return {
    name: fields.name,
    description: fields.description,
    model: fields.model,
    body: body.trim(),
  };
}

// ── Scan ───────────────────────────────────────────

/** 扫一层目录（非递归，与 Pi/OMP/CC 一致）。
 *  seen: realpath 去重集合（跨目录软链指向同一实体时只保留一次，防重复注入）。
 *  importedFrom: 传入即标记外部来源平台。 */
function scanDir(
  dir: string,
  level: SkillManifest["level"],
  disabledList: string[],
  source: SkillManifest["source"],
  seen?: Set<string>,
  importedFrom?: string,
): SkillManifest[] {
  if (!existsSync(dir)) return [];
  const results: SkillManifest[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const entryPath = path.join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const skillFile = path.join(entryPath, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      // realpath 去重：软链/硬链指向同一目录时只算一个（OMP 同为 realpath 去重）
      let real = entryPath;
      try {
        real = realpathSync(entryPath);
      } catch {
        // 解析失败按原路径处理
      }
      if (seen) {
        if (seen.has(real)) continue;
        seen.add(real);
      }
      const raw = readFileSync(skillFile, "utf-8");
      const fm = parseFrontmatter(raw);
      results.push({
        name: entry,
        description: fm.description || "(无描述)",
        path: entryPath,
        level,
        source,
        enabled: !disabledList.includes(entry),
        ...(importedFrom ? { importedFrom } : {}),
      });
    }
  } catch {
    // Permission errors etc. — return what we have
  }
  return results;
}

/** 扫外部生态目录（imported）：用户/项目级的 CC、Codex、GitHub Agent Skills 布局 */
function scanExternalSkills(projectPath: string | undefined, disabled: string[], seen: Set<string>): SkillManifest[] {
  if (!isExternalDiscoveryEnabled()) return [];
  const results: SkillManifest[] = [];
  for (const src of EXTERNAL_SOURCES) {
    if (src.level === "project" && !projectPath) continue;
    const dir = src.resolve(projectPath ?? "");
    results.push(...scanDir(dir, src.level, disabled, "imported", seen, src.platform));
  }
  return results;
}

/** 扫 managed 根（非递归一层）。symlink 条目跳过——managed 区只认真实目录，防 escape。 */
export function scanManagedSkills(): SkillManifest[] {
  if (!existsSync(MANAGED_SKILLS_DIR)) return [];
  const disabled = getHiddenSkills();
  const results: SkillManifest[] = [];
  try {
    for (const entry of readdirSync(MANAGED_SKILLS_DIR)) {
      const entryPath = path.join(MANAGED_SKILLS_DIR, entry);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(entryPath);
      } catch {
        continue;
      }
      if (!st.isDirectory()) continue;
      const skillFile = path.join(entryPath, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const raw = readFileSync(skillFile, "utf-8");
      const fm = parseFrontmatter(raw);
      results.push({
        name: entry,
        description: fm.description || "(无描述)",
        path: entryPath,
        level: "global",
        source: "managed",
        enabled: !disabled.includes(entry),
        managedRoot: MANAGED_SKILLS_DIR,
      });
    }
  } catch {
    // Permission errors etc. — return what we have
  }
  return results;
}

/** Scan all skill directories and return manifests.
 *
 *  Tier rules:
 *  - EM_SKILLS:      always shown as builtin (CC cannot see them).
 *                    Global copy with the same name is hidden (old seed artifact).
 *  - BUNDLED_SKILLS: global copy wins (user can customize). If no global copy,
 *                    fall back to the builtin version.
 *  - Everything else: shown as-is (user-installed). */
export function scanSkills(projectPath?: string): SkillManifest[] {
  const disabled = getHiddenSkills();
  const result: SkillManifest[] = [];
  // realpath 去重：跨目录（含外部生态目录）软链同一实体只算一次
  const seen = new Set<string>();

  // Builtin skills (resources/skills/)
  const builtinDir = getBuiltinSkillsDir();
  const builtin = scanDir(builtinDir, "builtin", disabled, "builtin", seen);
  const emBuiltinNames = new Set(EM_SKILLS);
  const bundledNames = new Set(BUNDLED_SKILLS);

  // Global skills
  const globalSkills = scanDir(GLOBAL_SKILLS_DIR, "global", disabled, "authored", seen);
  const globalNames = new Set(globalSkills.map((s) => s.name));

  /** 外部生态目录（imported）扫描——结果按名称去重，保留首个（扫描顺序即优先级） */

  // Builtin 归并（一次遍历按名称分类）：
  //  - EM skills: 恒为 builtin（不随全局副本隐藏）
  //  - Bundled skills: 全局副本优先；未装全局则 builtin 兜底
  //  - 其他 builtin: 直接展示
  for (const s of builtin) {
    if (emBuiltinNames.has(s.name)) {
      result.push(s);
    } else if (bundledNames.has(s.name)) {
      if (!globalNames.has(s.name)) result.push(s);
    } else {
      result.push(s);
    }
  }
  // Global skills — skip EM-owned names (those already shown as builtin above)
  for (const s of globalSkills) {
    if (!emBuiltinNames.has(s.name)) result.push(s);
  }

  // Project-level skills
  if (projectPath) {
    result.push(...scanDir(projectSkillsDir(projectPath), "project", disabled, "authored", seen));
  }

  // External skills（~/.claude/skills、~/.codex/skills、<p>/.claude/skills、<p>/.github/skills）
  // 排在 EM authored 之后：同名以 EM 自带/手写版本优先（对齐 OMP——自家 native 高于第三方）；
  // 同名外部条目仍列出并标 shadowed（与 managed 一致——界面可见可处置，不静默吞掉）
  const takenNames = new Set(result.map((s) => s.name));
  for (const s of scanExternalSkills(projectPath, disabled, seen)) {
    if (emBuiltinNames.has(s.name)) continue;
    result.push(takenNames.has(s.name) ? { ...s, shadowed: true } : s);
    takenNames.add(s.name);
  }

  // Managed skills — 同名时 authored/builtin 优先（shadow 标记，仍列出供管理界面处置）
  const existingNames = new Set(result.map((s) => s.name));
  for (const s of scanManagedSkills()) {
    result.push(existingNames.has(s.name) ? { ...s, shadowed: true } : s);
  }

  return result;
}

// ── Read detail ────────────────────────────────────

export function readSkill(skillPath: string): SkillDetail | null {
  const skillFile = path.join(skillPath, "SKILL.md");
  if (!existsSync(skillFile)) return null;
  const raw = readFileSync(skillFile, "utf-8");
  const fm = parseFrontmatter(raw);
  const name = path.basename(skillPath);
  const disabled = getHiddenSkills();
  const builtinDir = getBuiltinSkillsDir();
  let level: SkillManifest["level"] = "global";
  let source: SkillManifest["source"] = "authored";
  if (skillPath.startsWith(builtinDir)) {
    level = "builtin";
    source = "builtin";
  } else if (skillPath.startsWith(MANAGED_SKILLS_DIR)) {
    level = "global";
    source = "managed";
  } else if (!skillPath.startsWith(GLOBAL_SKILLS_DIR)) {
    level = "project";
  }
  return {
    name,
    description: fm.description || "(无描述)",
    path: skillPath,
    level,
    source,
    enabled: !disabled.includes(name),
    model: fm.model,
    body: fm.body,
  };
}

export function toggleSkill(name: string, enabled: boolean): void {
  const hidden = getHiddenSkills();
  const next = enabled
    ? hidden.filter((n) => n !== name)
    : [...hidden, name];
  saveHiddenSkills(next);
}

// ── Managed skill writes（AI 产物区）────────────────

const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SKILL_FILE_BYTES = 64 * 1024;

/** description 单行化：剥离控制字符/尖括号/反引号，防止 frontmatter 注入与提示词污染 */
function sanitizeDescription(desc: string): string {
  return desc
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/[<>`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

/** body 不允许自带 frontmatter（系统生成），带则剥离首部块 */
function stripLeadingFrontmatter(body: string): string {
  return body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/**
 * 写 managed 区（create 独占创建 / update 覆盖 / delete 递归删目录）。
 *
 * 安全约束：名称白名单字符集（含路径穿越免疫）；symlink 不跟随（root 目录与
 * SKILL.md 均校验为真实文件）；update 经临时文件 + rename 原子落盘（不截断
 * 共享 inode）；最终文件 ≤64KB；frontmatter 系统生成。
 *
 * 全程同步 fs 调用——单线程事件循环下天然串行，同名录写不会交错（无需锁）。
 */
export function writeManagedSkill(input: ManagedSkillInput, projectPath?: string): ManagedSkillResult {
  const { action, name } = input;
  if (!SKILL_NAME_RE.test(name)) {
    return { ok: false, error: "名称需匹配 [a-z0-9][a-z0-9-]{0,63}（小写字母/数字/连字符，≤64 字符）" };
  }
  if (lstatSafe(MANAGED_SKILLS_DIR)) {
    if (lstatSync(MANAGED_SKILLS_DIR).isSymbolicLink()) {
      return { ok: false, error: "managed-skills 根目录异常（symlink），拒绝写入" };
    }
  } else {
    mkdirSync(MANAGED_SKILLS_DIR, { recursive: true });
  }

  const skillDir = path.join(MANAGED_SKILLS_DIR, name);
  const skillFile = path.join(skillDir, "SKILL.md");

  if (action === "delete") {
    if (!existsSync(skillDir) && !lstatSafe(skillDir)) return { ok: false, error: `skill「${name}」不存在` };
    const st = lstatSync(skillDir);
    if (st.isSymbolicLink()) {
      unlinkSync(skillDir); // 只删链接本身，不动目标
    } else {
      rmSync(skillDir, { recursive: true });
    }
    return { ok: true };
  }

  if (action === "create") {
    // 撞 authored/builtin 同名 → shadowed，磁盘零写入
    const clash = scanSkills(projectPath).find(
      (s) => s.name === name && s.source !== "managed" && !s.shadowed,
    );
    if (clash) {
      return { ok: false, shadowed: true, error: `与现有 ${clash.source} skill「${name}」同名，被遮蔽。请换名或删除原 skill` };
    }
    if (lstatSafe(skillDir)) return { ok: false, error: `skill「${name}」已存在于 managed 区` };
    const desc = sanitizeDescription(input.description || "");
    if (!desc) return { ok: false, error: "description 不能为空" };
    const body = stripLeadingFrontmatter(input.body || "");
    if (!body) return { ok: false, error: "body 不能为空" };
    const content = renderSkillFile(name, desc, body);
    if (Buffer.byteLength(content, "utf-8") > MAX_SKILL_FILE_BYTES) {
      return { ok: false, error: `内容超限（>64KB），当前 ${Buffer.byteLength(content, "utf-8")} 字节` };
    }
    mkdirSync(skillDir);
    writeFileSync(skillFile, content);
    return { ok: true };
  }

  // update —— 只写 managed 区，永不触碰 authored
  if (input.description === undefined && input.body === undefined) {
    return { ok: false, error: "update 需至少提供 description 或 body" };
  }
  if (!lstatSafe(skillFile)) return { ok: false, error: `managed 区不存在 skill「${name}」（authored/builtin 不可由此更新）` };
  const st = lstatSync(skillFile);
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, error: "目标文件异常（symlink/非普通文件），拒绝覆盖" };
  if (lstatSync(skillDir).isSymbolicLink()) return { ok: false, error: "目标目录异常（symlink），拒绝写入" };

  const prev = parseFrontmatter(readFileSync(skillFile, "utf-8"));
  const desc = input.description !== undefined ? sanitizeDescription(input.description) : (prev.description || "");
  const body = input.body !== undefined ? stripLeadingFrontmatter(input.body) : prev.body;
  if (!desc) return { ok: false, error: "description 不能为空" };
  if (!body) return { ok: false, error: "body 不能为空" };
  const content = renderSkillFile(name, desc, body);
  if (Buffer.byteLength(content, "utf-8") > MAX_SKILL_FILE_BYTES) {
    return { ok: false, error: `内容超限（>64KB），当前 ${Buffer.byteLength(content, "utf-8")} 字节` };
  }
  // 临时文件 + rename：原子替换目录项，不截断可能存在的硬链接共享 inode
  const tmp = path.join(skillDir, `.SKILL.md.tmp-${Date.now()}`);
  writeFileSync(tmp, content);
  renameSync(tmp, skillFile);
  return { ok: true };
}

/** existsSync 跟随 symlink；此处的"存在"以 lstat 为准（断链 symlink 也算存在，需显式处理） */
function lstatSafe(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function renderSkillFile(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

// ── Lookup（供期 1 use_skill 工具复用）──────────────

/** 四来源合并查找：精确名优先，大小写不敏感兜底；project > global > builtin > managed，shadowed 排除 */
export function findSkillByName(name: string, projectPath?: string): SkillManifest | null {
  const all = scanSkills(projectPath).filter((s) => !s.shadowed);
  let pool = all.filter((s) => s.name === name);
  if (pool.length === 0) {
    const lower = name.toLowerCase();
    pool = all.filter((s) => s.name.toLowerCase() === lower);
  }
  if (pool.length === 0) return null;
  const prio = (s: SkillManifest): number => {
    const levelPrio = s.level === "project" ? 0 : s.level === "global" ? 1 : 2;
    return s.source === "managed" ? 3 + levelPrio : levelPrio;
  };
  return pool.sort((a, b) => prio(a) - prio(b))[0] ?? null;
}

// ── Delete（管理界面；builtin 拒删）─────────────────

/** 删除 skill 目录。只允许删已知 skill 根的直接子目录；内置不可删；symlink 只删链接本身。 */
export function deleteSkill(skillPath: string, projectPath?: string): { ok: boolean; error?: string } {
  const builtinDir = getBuiltinSkillsDir();
  const allowedRoots = [GLOBAL_SKILLS_DIR, MANAGED_SKILLS_DIR];
  if (projectPath) allowedRoots.push(projectSkillsDir(projectPath));
  const root = allowedRoots.find((r) => path.dirname(skillPath) === r);
  if (!root) {
    if (path.dirname(skillPath) === builtinDir) return { ok: false, error: "内置 skill 不可删除" };
    return { ok: false, error: "非 skill 目录，拒绝删除" };
  }
  if (!lstatSafe(skillPath)) return { ok: false, error: "目录不存在" };
  const st = lstatSync(skillPath);
  if (st.isSymbolicLink()) {
    unlinkSync(skillPath);
  } else if (st.isDirectory()) {
    rmSync(skillPath, { recursive: true });
  } else {
    return { ok: false, error: "目标不是 skill 目录" };
  }
  return { ok: true };
}


function getBuiltinSkillsDir(): string {
  // In packaged app: process.resourcesPath/skills
  // In dev: project root/resources/skills
  try {
    const rp = (process as { resourcesPath?: string }).resourcesPath;
    if (rp) {
      const p = path.join(rp, "skills");
      if (existsSync(p)) return p;
    }
  } catch { /* fall through */ }
  // Dev fallback: walk up from __dirname
  return path.join(getResourcesDir(), "skills");
}

/** Seed bundled skills to ~/.easymint/skills/ on first launch if missing.
 *  Unlike the old seedDefaultSkills, this only installs BUNDLED_SKILLS
 *  (third-party, EM 独立目录), not EM_SKILLS. Skips if already installed. */
export function seedBundledSkills(): void {
  const srcDir = getBuiltinSkillsDir();
  if (!existsSync(srcDir)) return;

  if (!existsSync(GLOBAL_SKILLS_DIR)) mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });

  for (const name of BUNDLED_SKILLS) {
    const targetPath = path.join(GLOBAL_SKILLS_DIR, name);
    if (existsSync(targetPath)) continue; // already installed
    const srcPath = path.join(srcDir, name);
    if (!existsSync(srcPath)) continue;
    cpSync(srcPath, targetPath, { recursive: true });
  }
}

// migrateBuiltinSkills removed — no longer auto-clean global skill/MCP dirs.

/** Skills owned by EM — only injected as builtin, never installed to global. CC cannot see them. */
const EM_SKILLS = ["ui-sync", "creation-guide", "creation-flow-intent", "creation-flow-features", "creation-flow-cost", "creation-flow-prototype", "creation-flow-techspec", "project-run", "dev-docs"];

/** Skills bundled with EM for convenience — auto-seeded to global on first launch if missing.
 *  Global copy takes priority (user can customize), builtin acts as fallback. CC can use them. */
const BUNDLED_SKILLS = ["ponytail", "ponytail-review", "ponytail-audit"];

// buildSkillsPrompt 已退役（期 1b）：skill 注入收敛到 Pi 原生 <available_skills>，
// 四来源经 pi-session 的 skillsOverride 并入（authored/managed 不在 Pi 扫描路径）。

/** 是否具备可用描述（无描述的不进会话 skill 列表，避免噪声） */
function hasDescription(s: SkillManifest): boolean {
  return !!s.description && s.description.trim().length > 0 && s.description !== "(无描述)";
}

/** EM SkillManifest → Pi Skill（结构化字面量满足 SDK 接口；source 标注来源便于诊断） */
export function toPiSkill(s: SkillManifest) {
  const filePath = path.join(s.path, "SKILL.md");
  return {
    name: s.name,
    description: s.description,
    filePath,
    baseDir: s.path,
    sourceInfo: {
      path: filePath,
      source: s.source === "managed" ? "easymint-managed" : "easymint",
      scope: s.level === "project" ? ("project" as const) : ("user" as const),
      origin: "top-level" as const,
    },
    disableModelInvocation: false,
  };
}

/** skillsOverride 合并体：EM 四来源（启用、非 shadow）并入 Pi 原生发现，原生同名优先。
 *  缺 description 的不注入——无描述模型无法判断何时用，属噪声（对齐 OMP requireDescription）；
 *  管理界面仍列出并标注，供用户补全后自动恢复。 */
export function mergeIntoPiSkills(projectPath: string | undefined, baseSkills: Array<{ name: string }>): ReturnType<typeof toPiSkill>[] {
  const seen = new Set(baseSkills.map((s) => s.name));
  return scanSkills(projectPath)
    .filter((s) => s.enabled && !s.shadowed && !seen.has(s.name) && hasDescription(s))
    .map(toPiSkill);
}

// ── Skill 导入（粘贴链接/目录 → 校验 → 拷入 authored 区） ────

import { execFileSync } from "node:child_process";

/** skill 目录名规范（与 managed 写入一致） */
const SKILL_DIR_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface SkillImportResult {
  ok: boolean;
  error?: string;
  name?: string;
  path?: string;
}

/** 从本地目录导入：校验 SKILL.md → 拷入 ~/.easymint/skills/<name>/（一层目录规范） */
export function importSkillFromDir(sourceDir: string, opts?: { name?: string; overwrite?: boolean }): SkillImportResult {
  const src = path.resolve(sourceDir.replace(/^~/, os.homedir()));
  const skillFile = path.join(src, "SKILL.md");
  if (!existsSync(skillFile)) {
    return { ok: false, error: "目录里没有 SKILL.md：" + src + "（外部 skill 需为「目录/SKILL.md」结构）" };
  }
  const name = (opts?.name || path.basename(src)).trim();
  if (!SKILL_DIR_NAME_RE.test(name)) {
    return { ok: false, error: "skill 名称不合法：「" + name + "」（需小写字母/数字/连字符）" };
  }
  const dest = path.join(GLOBAL_SKILLS_DIR, name);
  if (existsSync(dest) && !opts?.overwrite) {
    return { ok: false, error: "skill「" + name + "」已存在（覆盖请显式确认）" };
  }
  try {
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
    return { ok: true, name, path: dest };
  } catch (e) {
    return { ok: false, error: "拷贝失败：" + (e as Error).message };
  }
}

/** 从 GitHub/GitLab/Gitee 仓库导入：--depth 1 clone 到临时目录 → 定位 SKILL.md（根或一层子目录）→ 拷入。
 *  安全：只拷贝文件，不执行仓库内任何脚本。 */
export function importSkillFromUrl(url: string, opts?: { name?: string; overwrite?: boolean }): SkillImportResult {
  const u = url.trim();
  if (!/^https:\/\/(github\.com|gitlab\.com|gitee\.com)\//i.test(u)) {
    return { ok: false, error: "目前支持 GitHub / GitLab / Gitee 仓库链接（https）" };
  }
  const tmp = path.join(os.tmpdir(), "em-skill-import-" + Date.now());
  try {
    execFileSync("git", ["clone", "--depth", "1", u, tmp], { timeout: 120_000, stdio: "pipe" });
    if (existsSync(path.join(tmp, "SKILL.md"))) {
      return importSkillFromDir(tmp, { ...opts, name: opts?.name || path.basename(u).replace(/\.git$/, "") });
    }
    for (const entry of readdirSync(tmp)) {
      const sub = path.join(tmp, entry);
      if (statSync(sub).isDirectory() && existsSync(path.join(sub, "SKILL.md"))) {
        return importSkillFromDir(sub, { ...opts, name: opts?.name || entry });
      }
    }
    return { ok: false, error: "仓库里没找到 SKILL.md（根目录或一层子目录）——它可能不是标准 skill 仓库" };
  } catch (e) {
    return { ok: false, error: "clone 失败（检查网络/链接）：" + (e as Error).message };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
