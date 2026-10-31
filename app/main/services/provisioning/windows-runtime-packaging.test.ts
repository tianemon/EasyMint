import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import pinned from "../../../shared/windows-runtime.json";

const pack = createRequire(path.join(process.cwd(), "package.json"))("./scripts/prepare-windows-runtime.cjs") as {
  prepareWindowsRuntime: (arch: string, options: { projectDir: string; source: typeof pinned; download: (url: string, target: string) => Promise<void>; extract?: (archive: string, target: string, entries: string[]) => void }) => Promise<string>;
  verifyPackagedWindowsRuntime: (resources: string, arch: string, source: typeof pinned) => Promise<void>;
  contextArchitecture: (context: { arch: string | number }) => string;
  default: (context: { electronPlatformName: string }) => Promise<void>;
};
const bytes = Buffer.from("official-archive-fixture");
const digest = createHash("sha256").update(bytes).digest("hex");
const extraBytes = Buffer.from("extra-archive-fixture"), executable = Buffer.from("native-extractor-fixture");
const extraDigest = createHash("sha256").update(extraBytes).digest("hex"), exeDigest = createHash("sha256").update(executable).digest("hex");
const source = { ...pinned, archives: Object.fromEntries(Object.entries(pinned.archives).map(([arch, asset]) => [arch, { ...asset, sha256: digest }])),
  extractor: { ...pinned.extractor, archives: Object.fromEntries(Object.entries(pinned.extractor.archives).map(([arch, asset]) => [arch, { ...asset, archiveSha256: extraDigest, sha256: exeDigest }])) } } as typeof pinned;
const extract = (_archive: string, target: string, entries: string[]): void => {
  fs.mkdirSync(path.dirname(path.join(target, entries[0]!)), { recursive: true });
  fs.writeFileSync(path.join(target, entries[0]!), executable);
  fs.writeFileSync(path.join(target, "License.txt"), "upstream-license");
  fs.writeFileSync(path.join(target, "readme.txt"), "upstream-readme");
};
let root: string;
beforeEach(() => { root = path.join(process.cwd(), "temp/tests", `runtime-pack-${randomUUID()}`); fs.mkdirSync(root, { recursive: true }); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });
const download = vi.fn(async (url: string, target: string) => { fs.writeFileSync(target, url.endsWith("-extra.7z") ? extraBytes : bytes); });

it("prepares an offline resource set and reuses only a digest-verified cache", async () => {
  download.mockClear();
  const options = { projectDir: root, source, download, extract };
  const dir = await pack.prepareWindowsRuntime("x64", options);
  expect(download).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))).toMatchObject({ version: pinned.version, arch: "x64", fileName: "portable-git.7z.exe", sha256: digest });
  expect(fs.readFileSync(path.join(dir, "NOTICE.txt"), "utf8")).toContain(pinned.releaseTag);
  await pack.prepareWindowsRuntime("x64", options);
  expect(download).toHaveBeenCalledTimes(2);
  fs.writeFileSync(path.join(dir, "portable-git.7z.exe"), "broken-cache");
  await pack.prepareWindowsRuntime("x64", options);
  expect(download).toHaveBeenCalledTimes(3);
  expect(fs.readFileSync(path.join(dir, "portable-git.7z.exe"))).toEqual(bytes);
});

it("rejects a wrong download before it can become a packaged archive or manifest", async () => {
  await expect(pack.prepareWindowsRuntime("arm64", { projectDir: root, source, download: async (_url, target) => { fs.writeFileSync(target, "incorrect-bytes"); } })).rejects.toThrow("SHA-256 mismatch");
  expect(fs.readdirSync(path.join(root, "temp/runtime-resources/windows/arm64"))).toEqual([]);
});

it("pack verification checks actual bytes, architecture and the distribution notice", async () => {
  const dir = await pack.prepareWindowsRuntime("arm64", { projectDir: root, source, download, extract });
  const resources = path.join(root, "packed/resources");
  fs.mkdirSync(resources, { recursive: true });
  const target = path.join(resources, "windows-runtime"); fs.cpSync(dir, target, { recursive: true });
  await expect(pack.verifyPackagedWindowsRuntime(resources, "arm64", source)).resolves.toBeUndefined();
  await expect(pack.verifyPackagedWindowsRuntime(resources, "x64", source)).rejects.toThrow("manifest");
  fs.writeFileSync(path.join(target, "portable-git.7z.exe"), "broken-packed-bytes");
  await expect(pack.verifyPackagedWindowsRuntime(resources, "arm64", source)).rejects.toThrow("SHA-256 mismatch");
  fs.writeFileSync(path.join(target, "portable-git.7z.exe"), bytes);
  fs.writeFileSync(path.join(target, "7za.exe"), "tampered-extractor");
  await expect(pack.verifyPackagedWindowsRuntime(resources, "arm64", source)).rejects.toThrow("extractor SHA-256 mismatch");
  fs.writeFileSync(path.join(target, "7za.exe"), executable); fs.unlinkSync(path.join(target, "NOTICE.txt"));
  await expect(pack.verifyPackagedWindowsRuntime(resources, "arm64", source)).rejects.toThrow("notice");
});

it("does not prepare Windows payloads for other platforms and rejects unsupported architectures", async () => {
  await expect(pack.default({ electronPlatformName: "darwin" })).resolves.toBeUndefined();
  expect(pack.contextArchitecture({ arch: 1 })).toBe("x64");
  expect(pack.contextArchitecture({ arch: 3 })).toBe("arm64");
  expect(() => pack.contextArchitecture({ arch: 0 })).toThrow("Unsupported");
  await expect(pack.prepareWindowsRuntime("ia32", { projectDir: root, source, download })).rejects.toThrow("Unsupported");
  expect(fs.readdirSync(root)).toEqual([]);
});

it("rejects an extracted binary whose digest differs from the pinned native executable", async () => {
  await expect(pack.prepareWindowsRuntime("x64", { projectDir: root, source, download, extract: (_archive, target, entries) => {
    extract(_archive, target, entries); fs.writeFileSync(path.join(target, entries[0]!), "wrong-executable");
  } })).rejects.toThrow("extractor SHA-256 mismatch");
  const dir = path.join(root, "temp/runtime-resources/windows/x64");
  expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(false);
  expect(fs.readdirSync(dir).some(file => file.startsWith(".extractor-"))).toBe(false);
});
