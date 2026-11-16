import { expect, it } from "vitest";
import type { MachineProbe } from "./machine-profile";
import {
  MACHINE_CACHE_MS,
  findDevelopLogFile,
  machineSnapshot,
  readDevelopLog,
  type FileProbe,
  type MachineCache,
} from "./memory-source";

function files(table: Record<string, string>): FileProbe {
  return { readFile: (file) => (file in table ? table[file]! : null) };
}

it("按固定候选顺序找开发记录，命中第一个就停", () => {
  const probe = files({
    "/p/private_docs/开发记录.md": "# A",
    "/p/docs/开发记录.md": "# B",
  });
  expect(findDevelopLogFile("/p", probe)).toBe("/p/private_docs/开发记录.md");
  expect(readDevelopLog("/p", probe)).toBe("# A");
});

it("项目根下的开发记录优先于子目录", () => {
  const probe = files({ "/p/开发记录.md": "# root", "/p/private_docs/开发记录.md": "# sub" });
  expect(findDevelopLogFile("/p", probe)).toBe("/p/开发记录.md");
});

it("没有开发记录时返回 null，交给证据降级", () => {
  expect(findDevelopLogFile("/p", files({}))).toBeNull();
  expect(readDevelopLog("/p", files({}))).toBeNull();
});

it("末尾斜杠不影响路径拼装", () => {
  const probe = files({ "/p/开发记录.md": "# root" });
  expect(findDevelopLogFile("/p/", probe)).toBe("/p/开发记录.md");
});

function probe(): MachineProbe {
  const table: Record<string, string> = {
    "sysctl -n machdep.cpu.brand_string": "Apple M2",
    "sysctl -n hw.ncpu": "8",
    "sysctl -n hw.memsize": String(8 * 1024 ** 3),
    "sw_vers -productName": "macOS",
    "sw_vers -productVersion": "27.2.1",
    "node -v": "v22.22.2",
  };
  return { platform: "darwin", arch: "arm64", env: { SHELL: "/bin/zsh" }, run: (c) => table[c] ?? null };
}

it("本机快照在缓存期内直接复用，不重复采集", () => {
  const first = machineSnapshot(probe(), { at: 0 }, 1_000);
  expect(first.collected).toBe(true);
  const second = machineSnapshot(probe(), first.cache, 1_000 + MACHINE_CACHE_MS - 1);
  expect(second.collected).toBe(false);
  expect(second.snapshot).toEqual(first.snapshot);
});

it("缓存过期后重新采集，指纹未变时不改变版本", () => {
  const first = machineSnapshot(probe(), { at: 0 }, 1_000);
  const later = machineSnapshot(probe(), first.cache, 1_000 + MACHINE_CACHE_MS + 1);
  expect(later.collected).toBe(false);
  expect(later.snapshot.fingerprint).toBe(first.snapshot.fingerprint);
});

it("硬件或工具变化时版本号跟着变", () => {
  const before = machineSnapshot(probe(), { at: 0 }, 1_000).snapshot;
  const changed: MachineProbe = { ...probe(), run: (c) => (c === "node -v" ? "v23.0.0" : probe().run(c)) };
  const after = machineSnapshot(changed, { snapshot: before, at: 0 }, 1_000 + MACHINE_CACHE_MS + 1);
  expect(after.collected).toBe(true);
  expect(after.snapshot.fingerprint).not.toBe(before.fingerprint);
});

it("缓存结构可复用于下一次调用", () => {
  const cache: MachineCache = { at: 0 };
  const result = machineSnapshot(probe(), cache, 5_000);
  expect(result.cache.snapshot).toBeDefined();
  expect(result.cache.at).toBe(5_000);
});
