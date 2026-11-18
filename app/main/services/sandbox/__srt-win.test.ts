import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { packagedSrtVersion, srtWinPath, srtWinSpawn, unpackedAsarPath, windowsSandboxIssue } from "./srt-win";

/** 假 srt 模块：只提供我们用到的那两个公开量（真模块同样从包根导出它们） */
function fakeSrt(exe: string) {
  const resolveSrtWin = vi.fn((cfg: { path: string }) => ({ exe: cfg.path, prependArgs: ["--srt-win"] }));
  return { mod: { VENDORED_SRT_WIN_EXE: exe, resolveSrtWin } as never, resolveSrtWin };
}

describe("Windows：srt-win spawn 规格（不传该参数时 srt 必抛 no srt-win path configured）", () => {
  it("把包内 vendored exe 交给 srt 自己的 resolveSrtWin —— 不手拼 prependArgs", () => {
    const { mod, resolveSrtWin } = fakeSrt("/pkg/vendor/srt-win/x64/srt-win.exe");

    expect(srtWinSpawn(mod)).toEqual({
      exe: "/pkg/vendor/srt-win/x64/srt-win.exe",
      prependArgs: ["--srt-win"],
    });
    // 钉住"走 srt 的解析"这件事：`--srt-win` 是 srt 的内部常量，我们写死就会随上游改动失效
    expect(resolveSrtWin).toHaveBeenCalledWith({ path: "/pkg/vendor/srt-win/x64/srt-win.exe" });
  });
});

/**
 * 打包形态的钉子：`VENDORED_SRT_WIN_EXE` 在打包后位于 `app.asar` 内，而 srt 用 `spawn` 起它，
 * 必须改写到 `.asar.unpacked`（原因与实测结论见 srt-win.ts 文件头，以及本文件末的 Electron 实验）。
 */
describe("Windows：打包后把 asar 路径改写到 unpacked（否则 spawn 必 ENOTDIR）", () => {
  it("POSIX 与 Windows 两种分隔符都能改写，且只动第一处 `.asar`", () => {
    expect(unpackedAsarPath("/app/resources/app.asar/node_modules/x/vendor/srt-win/x64/srt-win.exe"))
      .toBe("/app/resources/app.asar.unpacked/node_modules/x/vendor/srt-win/x64/srt-win.exe");
    expect(unpackedAsarPath(String.raw`C:\app\resources\app.asar\node_modules\x\srt-win.exe`))
      .toBe(String.raw`C:\app\resources\app.asar.unpacked\node_modules\x\srt-win.exe`);
    // 目录名里含 `.asar` 但不是 asar 段（后面不跟分隔符）→ 原样返回
    expect(unpackedAsarPath("/tmp/app.asar.old/srt-win.exe")).toBe("/tmp/app.asar.old/srt-win.exe");
    // 开发态（node_modules 直接在工作区里）→ 原样返回
    expect(unpackedAsarPath("/repo/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win/x64/srt-win.exe"))
      .toBe("/repo/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win/x64/srt-win.exe");
  });

  it("srtWinSpawn 交给 srt 的 exe 已经是 unpacked 路径（打包态）", () => {
    const asarExe = "/app/resources/app.asar/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win/x64/srt-win.exe";
    const { mod, resolveSrtWin } = fakeSrt(asarExe);

    expect(srtWinSpawn(mod).exe).toBe(asarExe.replace("app.asar/", "app.asar.unpacked/"));
    expect(resolveSrtWin).toHaveBeenCalledWith({ path: srtWinPath(mod) });
  });
});

describe("包内 srt 版本（供手动命令钉版本，不写死第二处）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 造出 `<root>/vendor/srt-win/x64/srt-win.exe` 的目录形状 */
  function fixture(version: string | null): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "srt-ver-"));
    dirs.push(root);
    if (version !== null) {
      writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
    }
    mkdirSync(path.join(root, "vendor", "srt-win", "x64"), { recursive: true });
    return path.join(root, "vendor", "srt-win", "x64", "srt-win.exe");
  }

  it("从 vendor 路径上溯三层（<arch> → srt-win → vendor）读包根 package.json 的 version", () => {
    expect(packagedSrtVersion(fakeSrt(fixture("0.0.75")).mod)).toBe("0.0.75");
  });

  it("读不到（文件缺失）时返回 undefined —— 调用方退化为不钉版本，且不抛", () => {
    expect(packagedSrtVersion(fakeSrt(fixture(null)).mod)).toBeUndefined();
    expect(packagedSrtVersion(fakeSrt("/nowhere/srt-win.exe").mod)).toBeUndefined();
  });

  it("reads package metadata from the archive when only the exe is unpacked", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "em-srt-ver-asar-"));
    dirs.push(root);
    const archive = path.join(root, "app.asar");
    mkdirSync(archive);
    writeFileSync(path.join(archive, "package.json"), JSON.stringify({ version: "0.0.83" }));
    const exe = path.join(archive, "vendor", "srt-win", "x64", "srt-win.exe");
    expect(packagedSrtVersion(fakeSrt(exe).mod)).toBe("0.0.83");
  });

  it("打包形态：exe 在 `app.asar` 内、package.json 只存在于 `.asar.unpacked` 时仍读到版本", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "srt-ver-asar-"));
    dirs.push(root);
    // 真实布局：`app.asar` 只是个文件（这里用同名目录示意），`.asar.unpacked` 才是文件本体
    const unpackedRoot = path.join(root, "app.asar.unpacked");
    writeFileSync(path.join(root, "app.asar"), "not-a-real-archive");
    mkdirSync(path.join(unpackedRoot, "vendor", "srt-win", "x64"), { recursive: true });
    writeFileSync(path.join(unpackedRoot, "package.json"), JSON.stringify({ version: "0.0.75" }));

    const asarExe = path.join(root, "app.asar", "vendor", "srt-win", "x64", "srt-win.exe");
    expect(packagedSrtVersion(fakeSrt(asarExe).mod)).toBe("0.0.75");
  });
});

it("distinguishes stale Windows sandbox setup from limited WFP visibility", () => {
  const user = { provisioned: true, credPresent: true, setupVersion: 6, markerVersion: 6 } as Parameters<typeof windowsSandboxIssue>[0]["user"];
  const wfp = { state: "cannot-read", allowLoopback: false, filters: 0 } as const;
  expect(windowsSandboxIssue({ user, wfp })).toBeUndefined();
  expect(windowsSandboxIssue({ user: { ...user, markerVersion: 5 }, wfp })).toContain("版本不匹配");
  expect(windowsSandboxIssue({ user, wfp: { ...wfp, state: "loopback-mismatch" } })).toContain("配置不匹配");
});
