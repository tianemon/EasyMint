import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));

vi.mock("./native-config-storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("./native-config-storage")>();
  return { ...original, lockConfigDirectory: vi.fn(original.lockConfigDirectory) };
});

import { lockConfigDirectory } from "./native-config-storage";
import { Store } from "./store";

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("Store 构造的按需加锁", () => {
  it("文件齐全时不加目录锁，只在缺失时才加锁", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-store-")); dirs.push(dir);
    new Store(dir); // 首次：两个文件都缺 → 应加锁一次并建好文件
    expect(lockConfigDirectory).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(dir, "projects.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "em-settings.json"))).toBe(true);

    vi.mocked(lockConfigDirectory).mockClear();
    new Store(dir); // 再次：文件都在 → 快路径，不加锁
    expect(lockConfigDirectory).not.toHaveBeenCalled();
  });
});

describe("已下线功能残留的清理", () => {
  it("保存设置剔除废弃字段，未识别字段仍原样保留", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-store-obsolete-")); dirs.push(dir);
    const store = new Store(dir);
    const file = path.join(dir, "em-settings.json");
    fs.writeFileSync(file, JSON.stringify({
      setupComplete: true,
      groupPresets: [{ id: "dev-trio" }], builtinTools: { webSearch: true }, glowThickness: 2,
      someFutureField: "keep-me",
    }));

    store.saveSettings(store.getSettings());

    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    // 功能已下线的字段：写入时剔除，不再无限期随文件带下去
    expect(after.groupPresets).toBeUndefined();
    expect(after.builtinTools).toBeUndefined();
    expect(after.glowThickness).toBeUndefined();
    // 已知字段按分组结构落盘，旧扁平键不再残留（读侧虽有兜底，但文件里不该并存两份）
    expect(after.project.setupComplete).toBe(true);
    expect(after.setupComplete).toBeUndefined();
    // 「本版本不认识」的字段仍原样保留（跨版本兼容）
    expect(after.someFutureField).toBe("keep-me");
  });
});

describe("分组数组的落盘", () => {
  // 回归：这四个键是「内置组 + 自定义组」的合并结果，落盘只保留自定义组。若沿用
  // `isEmptyValue` 的"空数组视为无值"，用户删光自定义组后会被跳过写入，
  // 磁盘上的旧分组在下次启动复活（`GlowGroupManager.removeGroup` 的载荷含内置组）。
  const withCustom = { setupComplete: true, glowGroupsLight: [{ id: "custom-1", name: "自定义 1", colors: ["#16a34a"] }] };

  it("删光自定义组后磁盘同步为 []，重启不会复活", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-store-groups-")); dirs.push(dir);
    const store = new Store(dir);
    const file = path.join(dir, "em-settings.json");
    fs.writeFileSync(file, JSON.stringify(withCustom));

    const before = store.getSettings();
    const groupsBefore = before.glowGroupsLight ?? [];
    expect(groupsBefore.map((g) => g.id)).toContain("custom-1");
    // 渲染层删除该组后的实际载荷：内置组仍在数组里
    store.saveSettings({ ...before, glowGroupsLight: groupsBefore.filter((g) => g.isBuiltin) });

    expect(JSON.parse(fs.readFileSync(file, "utf8")).appearance.glow.groupsLight).toEqual([]);
    // 自定义组消失、只剩内置组与代码里的 v1 预置组（内置组是代码常量，清空不丢）
    const groupsAfter = store.getSettings().glowGroupsLight ?? [];
    expect(groupsAfter.filter((g) => g.id === "custom-1")).toEqual([]);
    expect(groupsAfter.filter((g) => g.isBuiltin)).toHaveLength(1);
  });

  it("自定义组仍在时照常落盘，且内置组不写入磁盘（防误改）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-store-groups2-")); dirs.push(dir);
    const store = new Store(dir);
    const file = path.join(dir, "em-settings.json");
    fs.writeFileSync(file, JSON.stringify(withCustom));

    const s = store.getSettings();
    const groups = s.glowGroupsLight ?? [];
    store.saveSettings({ ...s, glowGroupsLight: [...groups, { id: "custom-2", name: "自定义 2", colors: ["#000000"] }] });

    const saved = JSON.parse(fs.readFileSync(file, "utf8")).appearance.glow.groupsLight;
    expect(saved.map((g: { id: string }) => g.id)).toEqual(["custom-1", "custom-2"]);
  });
});
