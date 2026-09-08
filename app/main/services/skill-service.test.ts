import { describe, expect, it } from "vitest";
import { dedupeSelfSkills } from "./skill-service";
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
