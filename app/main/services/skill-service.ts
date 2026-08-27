/**
 * Skill Service — scan, import, delete, toggle skills.
 *
 * Skills are stored as folders with SKILL.md inside:
 *   Global:  ~/.easymint/skills/<name>/SKILL.md
 *   Project: <project>/.easymint/skills/<name>/SKILL.md
 *
 * 与 Claude Code 解耦:EM 用独立目录,不再读写 ~/.claude/skills/。
 * EasyMint maintains its own disabled-skills list in em-settings.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, cpSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { getResourcesDir } from "../utils/paths";

// ── Types ──────────────────────────────────────────

export interface SkillManifest {
  name: string;
  description: string;
  path: string;
  level: "builtin" | "global" | "project";
  enabled: boolean;
}

export interface SkillDetail extends SkillManifest {
  body: string;
}

// ── Constants ──────────────────────────────────────

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), ".easymint", "skills");

function projectSkillsDir(projectPath: string): string {
  return path.join(projectPath, ".easymint", "skills");
}

// ── Disabled skills list ───────────────────────────

const DISABLED_FILE = path.join(os.homedir(), ".easymint", "em-settings.json");

function getHiddenSkills(): string[] {
  if (!existsSync(DISABLED_FILE)) return [];
  const data = JSON.parse(readFileSync(DISABLED_FILE, "utf-8"));
  return (data.hiddenSkills as string[]) || [];
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

// ── YAML frontmatter parser ────────────────────────

function parseFrontmatter(content: string): { name?: string; description?: string; body: string } {
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
    body: body.trim(),
  };
}

// ── Scan ───────────────────────────────────────────

function scanDir(dir: string, level: SkillManifest["level"], disabledList: string[]): SkillManifest[] {
  if (!existsSync(dir)) return [];
  const results: SkillManifest[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const entryPath = path.join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const skillFile = path.join(entryPath, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const raw = readFileSync(skillFile, "utf-8");
      const fm = parseFrontmatter(raw);
      results.push({
        name: entry,
        description: fm.description || "(无描述)",
        path: entryPath,
        level,
        enabled: !disabledList.includes(entry),
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

  // Builtin skills (resources/skills/)
  const builtinDir = getBuiltinSkillsDir();
  const builtin = scanDir(builtinDir, "builtin", disabled);
  const emBuiltinNames = new Set(EM_SKILLS);
  const bundledNames = new Set(BUNDLED_SKILLS);

  // Global skills
  const globalSkills = scanDir(GLOBAL_SKILLS_DIR, "global", disabled);
  const globalNames = new Set(globalSkills.map((s) => s.name));

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
    result.push(...scanDir(projectSkillsDir(projectPath), "project", disabled));
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
  if (skillPath.startsWith(builtinDir)) level = "builtin";
  else if (!skillPath.startsWith(GLOBAL_SKILLS_DIR)) level = "project";
  return {
    name,
    description: fm.description || "(无描述)",
    path: skillPath,
    level,
    enabled: !disabled.includes(name),
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

// ── Build skills prompt block for SDK injection ────

/**
 * Generate a minimal prompt block listing available skills.
 * Only the frontmatter descriptions are injected — Claude uses these
 * to decide which skill is relevant. Full SKILL.md bodies are NOT
 * injected here; they're available on disk in the project's .easymint/skills/
 * directory and Claude can Read them as needed.
 */
/** 按分组输出 skill 列表段（空分组跳过）；path 直接指向 SKILL.md 文件，避免 Read 文件夹报 EISDIR */
function pushSkillGroup(lines: string[], title: string, skills: SkillManifest[]): void {
  if (skills.length === 0) return;
  lines.push(`### ${title}`);
  for (const s of skills) {
    lines.push(`- **${s.name}**: ${s.description} _(path: ${s.path}/SKILL.md)_`);
  }
  lines.push("");
}

export function buildSkillsPrompt(projectPath?: string): string {
  const skills = scanSkills(projectPath).filter((s) => s.enabled);
  if (skills.length === 0) return "";

  const lines: string[] = ["\n## Skills"];
  lines.push("The following skills are available. When a skill's description matches");
  lines.push("the user's request, Read the SKILL.md file at the listed path and follow it.\n");

  pushSkillGroup(lines, "Built-in", skills.filter((s) => s.level === "builtin"));
  pushSkillGroup(lines, "Global", skills.filter((s) => s.level === "global"));
  pushSkillGroup(lines, "Project", skills.filter((s) => s.level === "project"));

  return lines.join("\n");
}
