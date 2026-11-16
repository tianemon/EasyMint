import { expect, it } from "vitest";
import {
  collectMachineProfile,
  machineChanged,
  renderMachineSection,
  type MachineProbe,
} from "./machine-profile";

function darwinProbe(overrides: Record<string, string | null> = {}): MachineProbe {
  const table: Record<string, string> = {
    "sysctl -n machdep.cpu.brand_string": "Apple M2",
    "sysctl -n hw.ncpu": "8",
    "sysctl -n hw.memsize": String(8 * 1024 ** 3),
    "sw_vers -productName": "macOS",
    "sw_vers -productVersion": "27.2.1",
    "node -v": "v22.22.2",
    "npm -v": "10.9.0",
    "pnpm -v": "11.5.0",
    "git --version": "git version 2.54.0",
    ...overrides,
  };
  return {
    platform: "darwin",
    arch: "arm64",
    env: { SHELL: "/bin/zsh" },
    run: (command) => (command in table ? table[command]! : null),
  };
}

it("采集 macOS 的慢变项，并忽略磁盘余量这类运行态", () => {
  const profile = collectMachineProfile(darwinProbe());
  expect(profile.cpu).toBe("Apple M2");
  expect(profile.cores).toBe(8);
  expect(profile.memoryGb).toBe(8);
  expect(profile.os).toBe("macOS 27.2.1");
  expect(profile.tools).toEqual({ node: "22.22.2", npm: "10.9.0", pnpm: "11.5.0", git: "2.54.0" });
  expect(profile.shell).toBe("/bin/zsh");
  expect(JSON.stringify(profile)).not.toMatch(/可用|磁盘/u);
});

it("命令缺失不抛错，只留空字段", () => {
  const probe: MachineProbe = { platform: "linux", arch: "x64", run: () => null };
  const profile = collectMachineProfile(probe);
  expect(profile.cpu).toBeUndefined();
  expect(profile.tools).toEqual({});
  expect(profile.fingerprint).toHaveLength(16);
});

it("指纹只随慢变项变化：工具升级算变，运行态不算", () => {
  const base = collectMachineProfile(darwinProbe());
  const same = collectMachineProfile(darwinProbe());
  const upgraded = collectMachineProfile(darwinProbe({ "node -v": "v23.0.0" }));
  expect(machineChanged(base.fingerprint, same)).toBe(false);
  expect(machineChanged(base.fingerprint, upgraded)).toBe(true);
});

it("渲染结果不超过 600 字符且带规格与工具链", () => {
  const section = renderMachineSection(collectMachineProfile(darwinProbe()));
  expect(section.length).toBeLessThanOrEqual(600);
  expect(section).toContain("Apple M2 · 8 核 · 8GB");
  expect(section).toContain("工具链 node 22.22.2 · npm 10.9.0");
  expect(section.split("\n").every((line) => line.startsWith("- "))).toBe(true);
});
