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
    // 已知字段与「本版本不认识」的字段都不能被顺手删掉（跨版本兼容）
    expect(after.setupComplete).toBe(true);
    expect(after.someFutureField).toBe("keep-me");
  });
});
