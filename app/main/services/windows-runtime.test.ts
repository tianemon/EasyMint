import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import source from "../../shared/windows-runtime.json";
import { WindowsRuntimeService, windowsRuntimeEnvironment } from "./windows-runtime";
vi.mock("electron", () => ({ app: { isPackaged: false } }));
let root: string;
let service: WindowsRuntimeService;
let sourceManifest: typeof source;
type RuntimeRunner = ConstructorParameters<typeof WindowsRuntimeService>[0]["run"];
let run: Mock<RuntimeRunner>;
let failBash: boolean;
let leavePostInstall: boolean;
let extracting: (() => Promise<void>) | undefined;
const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
beforeEach(() => {
  root = path.join(process.cwd(), "temp/tests", `windows-runtime-${randomUUID()}`);
  const resources = path.join(root, "resources"); fs.mkdirSync(resources, { recursive: true });
  sourceManifest = structuredClone(source);
  sourceManifest.archives.x64.sha256 = digest("verified archive");
  sourceManifest.extractor.archives.x64.sha256 = digest("verified extractor");
  fs.writeFileSync(path.join(resources, "portable-git.7z.exe"), "verified archive");
  fs.writeFileSync(path.join(resources, "manifest.json"), JSON.stringify({ version: sourceManifest.version, arch: "x64", fileName: "portable-git.7z.exe", sha256: sourceManifest.archives.x64.sha256, extractor: { fileName: "7za.exe", sha256: digest("verified extractor") } }));
  fs.writeFileSync(path.join(resources, "7za.exe"), "verified extractor");
  failBash = false; leavePostInstall = false; extracting = undefined;
  run = vi.fn(async (file: string, args: string[], options: { cwd: string; signal?: AbortSignal }) => {
    if (args[0] === "x" || file.endsWith(".7z.exe")) {
      const stage = args.find(value => value.startsWith("-o"))!.slice(2);
      for (const rel of ["cmd/git.exe", "bin/bash.exe", "git-bash.exe", "usr/bin/sed.exe", "usr/bin/awk.exe", "usr/bin/find.exe", "post-install.bat"]) {
        fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true }); fs.writeFileSync(path.join(stage, rel), "fixture");
      }
      fs.mkdirSync(path.join(stage, "etc/post-install"), { recursive: true });
      if (extracting) await extracting();
      options.signal?.throwIfAborted();
      return "";
    }
    if (path.basename(file) === "git-bash.exe") {
      if (!leavePostInstall) { fs.unlinkSync(path.join(options.cwd, "post-install.bat")); fs.rmSync(path.join(options.cwd, "etc/post-install"), { recursive: true }); }
      return "";
    }
    if (file.endsWith("git.exe")) return `git version ${sourceManifest.releaseTag.slice(1)}\n`;
    return failBash ? "not a valid runtime" : "git version fixture.windows.1\n__EM_RUNTIME_OK__";
  });
  service = new WindowsRuntimeService({ arch: "x64", dataRoot: path.join(root, "owned"), resources, manifest: sourceManifest, run });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const oldRuntime = () => { const paths = service.paths(); fs.mkdirSync(paths.root, { recursive: true }); fs.writeFileSync(path.join(paths.root, "old-copy"), "preserve"); return paths; };
const assertNoStage = () => expect(fs.readdirSync(path.join(root, "owned/git")).some(name => name.includes(".staging-"))).toBe(false);

describe("bundled Windows runtime lifecycle", () => {
  it("prepares, runs official initialization, verifies actual execution and reuses a ready version", async () => {
    expect((await service.probe()).status).toBe("missing");
    const paths = await service.ensure();
    expect((await service.probe()).status).toBe("ready");
    expect(fs.existsSync(paths.git)).toBe(true);
    expect(run.mock.calls[0]![0]).toBe(path.join(root, "resources/7za.exe"));
    expect(run.mock.calls[0]![1]).toContain("-bd");
    expect(run.mock.calls.some(call => call[0].endsWith(".7z.exe"))).toBe(false);
    expect(run.mock.calls.some(call => call[1].includes("--command=post-install.bat"))).toBe(true);
    const count = run.mock.calls.length;
    await service.ensure(); expect(run).toHaveBeenCalledTimes(count);
    assertNoStage();
  });
  it("rejects altered bundled bytes before launching anything and preserves the prior copy", async () => {
    const old = oldRuntime();
    fs.writeFileSync(path.join(root, "resources/portable-git.7z.exe"), "tampered");
    await expect(service.ensure()).rejects.toThrow(/checksum/);
    expect(run).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(old.root, "old-copy"), "utf8")).toBe("preserve");
  });
  it("rejects an altered extractor before running either executable", async () => {
    fs.writeFileSync(path.join(root, "resources/7za.exe"), "tampered-extractor");
    await expect(service.ensure()).rejects.toThrow(/checksum/);
    expect(run).not.toHaveBeenCalled();
  });
  it("does not accept a runnable but unexpected Git version", async () => {
    const original = run.getMockImplementation()!;
    run.mockImplementation((file, args, options) => file.endsWith("git.exe") ? Promise.resolve("git version 0.1.windows.1\n") : original(file, args, options));
    await expect(service.ensure()).rejects.toThrow("Git runtime verification failed"); assertNoStage();
  });
  it("does not publish an unverified replacement and cleans its own stage", async () => {
    const old = oldRuntime(); failBash = true;
    await expect(service.ensure()).rejects.toThrow("Bash runtime verification failed");
    expect(fs.readFileSync(path.join(old.root, "old-copy"), "utf8")).toBe("preserve");
    expect(fs.existsSync(path.join(old.root, ".em-ready.json"))).toBe(false); assertNoStage();
  });
  it("rejects incomplete post-install instead of treating extracted files as ready", async () => {
    oldRuntime(); leavePostInstall = true;
    await expect(service.ensure()).rejects.toThrow("initialization did not finish"); assertNoStage();
  });
  it("repairs missing executables from the pinned bundle after recheck", async () => {
    const paths = await service.ensure(); fs.unlinkSync(paths.bash); service.reset();
    expect((await service.probe()).status).toBe("broken");
    await service.ensure(); expect(fs.existsSync(paths.bash)).toBe(true); assertNoStage();
  });
  it("coalesces callers and lets one cancel without aborting another's preparation", async () => {
    let release!: () => void;
    extracting = () => new Promise<void>(resolve => { release = resolve; });
    const controller = new AbortController();
    const first = service.ensure({ signal: controller.signal }).catch(error => error);
    const second = service.ensure();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    controller.abort(); expect((await first).name).toBe("AbortError");
    release(); expect((await second).git).toBe(service.paths().git);
    expect(run.mock.calls.filter(call => call[0].endsWith(".7z.exe") || call[1][0] === "x")).toHaveLength(1);
  });
  it("all callers cancelling prevents a partial stage from becoming the current runtime", async () => {
    oldRuntime(); let release!: () => void;
    extracting = () => new Promise<void>(resolve => { release = resolve; });
    const controller = new AbortController();
    const result = service.ensure({ signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    controller.abort(); expect((await result).name).toBe("AbortError");
    release(); await vi.waitFor(() => assertNoStage());
    expect(fs.readFileSync(path.join(service.paths().root, "old-copy"), "utf8")).toBe("preserve");
  });
  it("serializes preparation across instances sharing a runtime directory", async () => {
    const other = new WindowsRuntimeService({ arch: "x64", dataRoot: path.join(root, "owned"), resources: path.join(root, "resources"), manifest: sourceManifest, run });
    const [first, second] = await Promise.all([service.ensure(), other.ensure()]);
    expect(first).toEqual(second);
    expect(run.mock.calls.filter(call => call[0].endsWith(".7z.exe") || call[1][0] === "x")).toHaveLength(1);
  });
  it("an immediate retry waits for cancelled cleanup and starts a fresh preparation", async () => {
    let release!: () => void, calls = 0;
    extracting = async () => { if (++calls === 1) await new Promise<void>(resolve => { release = resolve; }); };
    const controller = new AbortController();
    const first = service.ensure({ signal: controller.signal }).catch(error => error);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    controller.abort(); expect((await first).name).toBe("AbortError");
    const second = service.ensure(); release();
    expect((await second).git).toBe(service.paths().git); expect(calls).toBe(2);
  });
  it("rejects an unsupported target architecture before preparing files", async () => {
    const invalid = new WindowsRuntimeService({ arch: "ia32", dataRoot: root, resources: root, manifest: sourceManifest, run });
    await expect(invalid.ensure()).rejects.toThrow("Unsupported"); expect(run).not.toHaveBeenCalled();
  });
  it("only adjusts child PATH and preserves Windows case-insensitive environment semantics", () => {
    const original = { Path: "C:\\original", KEEP: "yes" };
    const env = windowsRuntimeEnvironment(original, service.paths());
    expect(original).toEqual({ Path: "C:\\original", KEEP: "yes" });
    expect(env.Path).toBeUndefined(); expect(env.PATH).toContain("C:\\original");
    expect(env.PATH!.startsWith(path.join(service.paths().root, "cmd") + ";")).toBe(true);
    expect(env.KEEP).toBe("yes");
  });
});
