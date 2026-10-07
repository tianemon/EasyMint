import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codegraphCandidates, codegraphEnvironment, codegraphInvocation } from "./codegraph-command";
import { detectCodegraph } from "./codegraph-detector";

vi.mock("node:fs", () => ({ default: { existsSync: vi.fn() } }));
vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const originalPlatform = process.platform;
const install = "C:\\Users\\Test User\\AppData\\Local\\codegraph\\current";
const launcher = `${install}\\bin\\codegraph.cmd`;
let files: Set<string>;
beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "win32" });
  vi.stubEnv("PATH", "C:\\Windows\\System32");
  vi.stubEnv("LOCALAPPDATA", "C:\\Users\\Test User\\AppData\\Local");
  vi.stubEnv("APPDATA", "C:\\Users\\Test User\\AppData\\Roaming");
  vi.stubEnv("CODEGRAPH_INSTALL_DIR", "");
  files = new Set([launcher, `${install}\\node.exe`, `${install}\\lib\\dist\\bin\\codegraph.js`]);
  vi.mocked(fs.existsSync).mockImplementation(value => files.has(String(value)));
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: "1.6.0\n" } as never);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks();
});

describe("CodeGraph Windows detection and launch", () => {
  it("finds a newly installed standalone bundle with stale GUI PATH and uses its node", () => {
    expect(detectCodegraph()).toEqual({ found: true, version: "1.6.0" });
    expect(spawnSync).toHaveBeenCalledWith(`${install}\\node.exe`, [`${install}\\lib\\dist\\bin\\codegraph.js`, "--version"], expect.anything());
    expect(codegraphInvocation("codegraph", ["serve", "--mcp"], codegraphEnvironment())).toEqual({
      command: `${install}\\node.exe`, args: [`${install}\\lib\\dist\\bin\\codegraph.js`, "serve", "--mcp"],
    });
  });
  it("uses cmd for an npm shim in a custom PATH directory and preserves spaced paths", () => {
    const npm = "D:\\My Tools\\codegraph.cmd";
    files = new Set([npm, npm.slice(0, -4)]); vi.stubEnv("PATH", "D:\\My Tools");
    expect(detectCodegraph().found).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith(expect.stringMatching(/cmd\.exe$/i), ["/d", "/s", "/c", `""${npm}" --version"`], expect.objectContaining({ windowsVerbatimArguments: true }));
    expect(codegraphInvocation("codegraph", [], codegraphEnvironment()).shellCommand).toBe(npm.slice(0, -4));
  });
  it("reports a broken PATH installation as a probe error", () => {
    files = new Set(["D:\\custom\\codegraph.cmd"]); vi.stubEnv("PATH", "D:\\custom");
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: "" } as never);
    expect(detectCodegraph()).toEqual({ found: false, reason: "probe-error" });
  });
  it("reports not-found only when no Windows executable exists", () => {
    files.clear();
    expect(detectCodegraph()).toEqual({ found: false, reason: "not-found" });
    expect(spawnSync).not.toHaveBeenCalled();
  });
  it("reads updated environment on retest and removes Electron/Node probe pollution", () => {
    files.clear(); expect(detectCodegraph().found).toBe(false);
    files.add("E:\\CodeGraph\\current\\bin\\codegraph.cmd");
    vi.stubEnv("CODEGRAPH_INSTALL_DIR", "E:\\CodeGraph");
    vi.stubEnv("NODE_OPTIONS", "--invalid"); vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    expect(detectCodegraph().found).toBe(true);
    const env = vi.mocked(spawnSync).mock.calls[0]![2]!.env!;
    expect(env.NODE_OPTIONS).toBeUndefined(); expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });
  it("handles Windows Path casing without introducing undefined directories", () => {
    const env = codegraphEnvironment({ Path: `"${install}\\bin"` }, "win32");
    expect(env.Path).toBeUndefined(); expect(env.PATH).not.toContain("undefined");
    expect(codegraphCandidates(env, "win32")).toContain(launcher);
    expect(codegraphEnvironment({ Path: "C:\\host", PATH: "D:\\managed" }, "win32")).toEqual({ PATH: "D:\\managed" });
  });
  it("keeps Unix version probes as direct argv launches", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(detectCodegraph().found).toBe(true);
    expect(spawnSync).toHaveBeenCalledWith("codegraph", ["--version"], expect.anything());
  });
});
