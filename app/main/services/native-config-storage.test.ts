import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { lockConfigDirectory } from "./native-config-storage";

const require = createRequire(path.join(__dirname, "native-config-storage.test.cjs"));
const lockfile = require("proper-lockfile") as { lockSync(file: string, options: { realpath: boolean }): () => void };

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("lockConfigDirectory 的有界重试", () => {
  it("空闲时立即获得；被持有时失败且保持互斥（真实 fs 下为 10 次 × 20ms 休眠后放弃）", () => {
    const free = fs.mkdtempSync(path.join(os.tmpdir(), "em-lock-free-")); dirs.push(free);
    const t0 = Date.now();
    lockConfigDirectory(free)();
    expect(Date.now() - t0).toBeLessThan(150);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "em-lock-held-")); dirs.push(dir);
    // 模拟另一个 EM 进程持有该目录锁
    const hold = lockfile.lockSync(dir, { realpath: true });
    let thrown: NodeJS.ErrnoException | undefined;
    try {
      const start = Date.now();
      try { lockConfigDirectory(dir); } catch (error) { thrown = error as NodeJS.ErrnoException; }
      const elapsed = Date.now() - start;
      // 核心互斥语义：锁已被占用 ⇒ 必须抛错，绝不能静默拿到锁（与错误码无关，任何环境都成立）
      expect(thrown).toBeDefined();
      // 错误码只在真实 fs 下可信（ELOCKED）：此时才校验重试节奏——
      // fs 垫片环境会把 mkdir 的 EEXIST 改写成自己的错误码（实测 WorkBuddy broker 改写为
      // CODEBUDDY_BROKER_DENY，env -u NODE_OPTIONS 后为真实 ELOCKED），那种环境下立即失败，
      // 计时无意义，跳过
      if (thrown!.code === "ELOCKED") {
        expect(elapsed).toBeGreaterThanOrEqual(150);
        expect(elapsed).toBeLessThan(5000);
      }
    } finally { hold(); }
  });
});
