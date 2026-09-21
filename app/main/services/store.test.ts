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
