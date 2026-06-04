/**
 * Skill Service — scan, import, delete, toggle skills.
 *
 * Skills are stored as folders with SKILL.md inside:
 *   Global:  ~/.claude/skills/<name>/SKILL.md
 *   Project: <project>/.claude/skills/<name>/SKILL.md
 *
 * Shared with Claude Code — both read the same directories.
 * EasyMint maintains its own disabled-skills list in em-settings.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, cpSync } from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Types ──────────────────────────────────────────

export interface SkillManifest {
  name: string;
  description: string;
  path: string;
  level: "global" | "project";
  enabled: boolean;
}

export interface SkillDetail extends SkillManifest {
  body: string;
}

// ── Constants ──────────────────────────────────────

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), ".claude", "skills");

function projectSkillsDir(projectPath: string): string {
  return path.join(projectPath, ".claude", "skills");
}

// ── Disabled skills list ───────────────────────────

const DISABLED_FILE = path.join(os.homedir(), ".easymint", "em-settings.json");

function getHiddenSkills(): string[] {
  try {
    if (!existsSync(DISABLED_FILE)) return [];
    const data = JSON.parse(readFileSync(DISABLED_FILE, "utf-8"));
    return (data.hiddenSkills as string[]) || [];
  } catch {
    return [];
  }
}

function saveHiddenSkills(list: string[]): void {
  const dir = path.dirname(DISABLED_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data: Record<string, unknown> = {};
  if (existsSync(DISABLED_FILE)) {
    try { Object.assign(data, JSON.parse(readFileSync(DISABLED_FILE, "utf-8"))); } catch { /* overwrite */ }
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

function scanDir(dir: string, level: "global" | "project", disabledList: string[]): SkillManifest[] {
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

/** Scan all skill directories and return manifests */
export function scanSkills(projectPath?: string): SkillManifest[] {
  const disabled = getHiddenSkills();
  const result: SkillManifest[] = [];

  // Global skills
  result.push(...scanDir(GLOBAL_SKILLS_DIR, "global", disabled));

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
  try {
    const raw = readFileSync(skillFile, "utf-8");
    const fm = parseFrontmatter(raw);
    const name = path.basename(skillPath);
    const disabled = getHiddenSkills();
    const isProject = !skillPath.startsWith(GLOBAL_SKILLS_DIR);
    return {
      name,
      description: fm.description || "(无描述)",
      path: skillPath,
      level: isProject ? "project" : "global",
      enabled: !disabled.includes(name),
      body: fm.body,
    };
  } catch {
    return null;
  }
}

// ── Import ─────────────────────────────────────────

/** Import a skill from a source directory into the target level */
export function importSkill(
  sourcePath: string,
  level: "global" | "project",
  projectPath?: string,
): SkillManifest {
  const skillFile = path.join(sourcePath, "SKILL.md");
  if (!existsSync(skillFile)) {
    throw new Error(`源目录中未找到 SKILL.md: ${sourcePath}`);
  }

  // Read source to get the skill name
  const raw = readFileSync(skillFile, "utf-8");
  const fm = parseFrontmatter(raw);
  const skillName = fm.name || path.basename(sourcePath);

  const targetDir = level === "global"
    ? GLOBAL_SKILLS_DIR
    : projectSkillsDir(projectPath || "");
  const targetPath = path.join(targetDir, skillName);

  // Copy entire folder
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }
  cpSync(sourcePath, targetPath, { recursive: true });

  // Ensure enabled after import
  const disabled = getHiddenSkills().filter((n) => n !== skillName);
  saveHiddenSkills(disabled);

  return {
    name: skillName,
    description: fm.description || "(无描述)",
    path: targetPath,
    level,
    enabled: true,
  };
}

// ── Delete (hide from EM, keep files on disk) ──────

export function deleteSkill(skillPath: string): void {
  const name = path.basename(skillPath);
  const list = getHiddenSkills();
  if (!list.includes(name)) {
    list.push(name);
    saveHiddenSkills(list);
  }
}

// ── Toggle ─────────────────────────────────────────

export function toggleSkill(name: string, enabled: boolean): void {
  const disabled = getHiddenSkills();
  if (enabled) {
    saveHiddenSkills(disabled.filter((n) => n !== name));
  } else {
    if (!disabled.includes(name)) {
      disabled.push(name);
      saveHiddenSkills(disabled);
    }
  }
}

// ── Seed built-in skills ───────────────────────────

const BUILTIN_SKILLS = ["plan-first", "requirement-breakdown", "describe-image", "web-verify", "easymint-guide"];

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
  return path.join(__dirname, "..", "..", "..", "resources", "skills");
}

/** Copy built-in skills to ~/.claude/skills/ on first launch or after deletion */
export function seedDefaultSkills(): void {
  const srcDir = getBuiltinSkillsDir();
  if (!existsSync(srcDir)) return;

  if (!existsSync(GLOBAL_SKILLS_DIR)) mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });

  const hidden = getHiddenSkills();

  for (const name of BUILTIN_SKILLS) {
    const targetPath = path.join(GLOBAL_SKILLS_DIR, name);
    if (existsSync(targetPath)) continue; // already exists

    // Don't restore if user explicitly hid/deleted via EM
    if (hidden.includes(name)) continue;

    const srcPath = path.join(srcDir, name);
    if (!existsSync(srcPath)) continue;

    try {
      cpSync(srcPath, targetPath, { recursive: true });
      console.log("[seedDefaultSkills] installed:", name);
    } catch (err) {
      console.error("[seedDefaultSkills] failed:", name, err);
    }
  }
}

// ── Build skills prompt block for SDK injection ────

/**
 * Generate a minimal prompt block listing available skills.
 * Only the frontmatter descriptions are injected — Claude uses these
 * to decide which skill is relevant. Full SKILL.md bodies are NOT
 * injected here; they're available on disk in the project's .claude/skills/
 * directory and Claude can Read them as needed.
 */
export function buildSkillsPrompt(projectPath?: string): string {
  const skills = scanSkills(projectPath).filter((s) => s.enabled);
  if (skills.length === 0) return "";

  const globalSkills = skills.filter((s) => s.level === "global");
  const projectSkills = skills.filter((s) => s.level === "project");

  const lines: string[] = ["\n## Skills"];
  lines.push("The following skills are available. Each skill lives in a folder");
  lines.push("with a SKILL.md file. When a skill's description matches the user's");
  lines.push("request, Read its SKILL.md at the listed path and follow it.\n");

  if (globalSkills.length > 0) {
    lines.push("### Global");
    for (const s of globalSkills) {
      lines.push(`- **${s.name}**: ${s.description} _(path: ${s.path})_`);
    }
    lines.push("");
  }

  if (projectSkills.length > 0) {
    lines.push("### Project");
    for (const s of projectSkills) {
      lines.push(`- **${s.name}**: ${s.description} _(path: ${s.path})_`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
