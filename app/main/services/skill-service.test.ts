import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("electron", () => ({ app: { isPackaged: false } }));

import { dedupeExternalSkills, dedupeSelfSkills, readSkill } from "./skill-service";
import type { SkillManifest } from "./skill-service";

function m(name: string, level: SkillManifest["level"]): SkillManifest {
  return {
    name,
    description: "d",
    path: `/tmp/${level}/${name}`,
    level,
    source: level === "builtin" ? "builtin" : "authored",
    enabled: true,
  };
}

const live = (list: SkillManifest[]): SkillManifest[] => list.filter((s) => !s.shadowed);

describe("dedupeSelfSkills", () => {
  it("全局与项目级同名 → 项目级胜出，全局标 shadowed（不静默丢弃）", () => {
    const list = [m("foo", "global"), m("foo", "project")];
    dedupeSelfSkills(list, new Set());
    expect(live(list).map((s) => s.level)).toEqual(["project"]);
    expect(list.find((s) => s.level === "global")?.shadowed).toBe(true);
  });

  it("内置与全局同名 → 全局胜出", () => {
    const list = [m("foo", "builtin"), m("foo", "global")];
    dedupeSelfSkills(list, new Set());
    expect(live(list).map((s) => s.level)).toEqual(["global"]);
  });

  it("三来源同名只留一条", () => {
    const list = [m("foo", "builtin"), m("foo", "global"), m("foo", "project")];
    dedupeSelfSkills(list, new Set());
    expect(live(list).map((s) => s.level)).toEqual(["project"]);
  });

  it("大小写同名视为同一 skill", () => {
    const list = [m("Foo", "global"), m("foo", "project")];
    dedupeSelfSkills(list, new Set());
    expect(live(list)).toHaveLength(1);
  });

  it("受保护的内置名恒优先（不被项目级顶替）", () => {
    const list = [m("ui-sync", "builtin"), m("ui-sync", "project")];
    dedupeSelfSkills(list, new Set(["ui-sync"]));
    expect(live(list).map((s) => s.level)).toEqual(["builtin"]);
  });

  it("不同名互不影响", () => {
    const list = [m("a", "global"), m("b", "project"), m("c", "builtin")];
    dedupeSelfSkills(list, new Set());
    expect(live(list)).toHaveLength(3);
  });
});

function ext(name: string, level: "global" | "project", from: string): SkillManifest {
  return {
    name,
    description: "d",
    path: `/tmp/${from}-${level}/${name}`,
    level,
    source: "imported",
    enabled: true,
    importedFrom: from,
  };
}

describe("dedupeExternalSkills", () => {
  it("项目级胜过全局（对齐 Codex / Claude Code 官方）", () => {
    const list = [ext("foo", "global", "claude"), ext("foo", "project", "claude")];
    dedupeExternalSkills(list);
    expect(live(list).map((s) => s.level)).toEqual(["project"]);
    expect(list.find((s) => s.level === "global")?.shadowed).toBe(true);
  });

  it("跨 provider 也是项目级胜（scope 优先于 provider 顺序）", () => {
    const list = [ext("foo", "global", "codex"), ext("foo", "project", "github")];
    dedupeExternalSkills(list);
    expect(live(list).map((s) => s.importedFrom)).toEqual(["github"]);
  });

  it("同 scope 时保留 provider 顺序在前者（claude > codex > github）", () => {
    const list = [ext("foo", "global", "claude"), ext("foo", "global", "codex")];
    dedupeExternalSkills(list);
    expect(live(list).map((s) => s.importedFrom)).toEqual(["claude"]);
  });

  it("项目级三者同名：保留 claude", () => {
    const list = [
      ext("foo", "project", "claude"),
      ext("foo", "project", "codex"),
      ext("foo", "project", "github"),
    ];
    dedupeExternalSkills(list);
    expect(live(list).map((s) => s.importedFrom)).toEqual(["claude"]);
  });
});

function mkExternalSkill(root: string, platform: "claude" | "codex"): string {
  const dir = path.join(root, `.${platform}`, "skills", "ext-proj");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), "---\nname: ext-proj\ndescription: 外部测试\n---\n\n正文\n");
  return dir;
}

describe("readSkill 外部生态标注", () => {
  it("项目级外部目录(claude/codex)与列表侧一致标 imported", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "em-readskill-"));
    for (const platform of ["claude", "codex"] as const) {
      const d = readSkill(mkExternalSkill(root, platform));
      expect(d?.source).toBe("imported");
      expect(d?.importedFrom).toBe(platform);
      expect(d?.level).toBe("project");
    }
  });
});
