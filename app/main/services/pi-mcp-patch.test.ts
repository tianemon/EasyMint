import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 版本来源与 scripts/patch-pi-mcp.cjs 同源：只取 package.json 里声明的精确版本，这里不写死版本号。
 * 改 package.json 的读取方式、改缓存文件命名，都要同步改那个脚本（它的文件头列了全部引用点）。
 */
const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const declaredPiVersion: string = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).dependencies[PI_PACKAGE];
const cacheFile = `easymint-pi-mcp-${declaredPiVersion}.json`;

describe("Pi MCP patch (version derived from package.json)", () => {
  it("declares the Pi SDK as an exact version so the patch gate cannot drift", () => {
    // 脚本的闸门是「已安装版本 === 声明版本」；写成 ^ 范围时两者随时可能不等，补丁会在 postinstall 失败。
    expect(declaredPiVersion).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it("keeps upstream summary behavior by default and allows an explicit stable-summary opt-out", async () => {
    const module = await import(pathToFileURL(path.resolve("node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/index.js")).href);
    const entry = { name: "fixture", source: "fixture", config: { type: "stdio", command: "fixture", exposure: "codemode" } };
    const before = [{ entry }];
    const after = [{ entry, connection: { instructions: "external server instructions" } }];
    expect(module.renderServersSection(before)).not.toBe(module.renderServersSection(after));
    expect(module.renderServersSection(before, false)).toBe(module.renderServersSection(after, false));
    expect(module.renderServersSection(after, false)).not.toContain("external server instructions");
  });

  it("generates deterministically from clean upstream source and refuses unrecognized source changes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-patch-"));
    try {
      // 脚本按 __dirname/../package.json 读声明版本，所以临时目录里也要有一份同值的 package.json。
      const declare = (version: string) => fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { [PI_PACKAGE]: version } }));
      declare(declaredPiVersion);
      const scripts = path.join(root, "scripts"); fs.mkdirSync(scripts);
      const script = path.join(scripts, "patch-pi-mcp.cjs");
      fs.copyFileSync(path.resolve("scripts/patch-pi-mcp.cjs"), script);
      // 夹具用 postinstall 落下的补丁前原始源码；没有它说明没跑过 npm install 的 postinstall。
      const cached = JSON.parse(fs.readFileSync(path.resolve("node_modules/.cache", cacheFile), "utf8"));
      const vendor = path.join(root, "node_modules", PI_PACKAGE);
      fs.mkdirSync(vendor, { recursive: true });
      fs.writeFileSync(path.join(vendor, "package.json"), JSON.stringify({ version: declaredPiVersion, type: "module" }));
      for (const [file, value] of Object.entries(cached) as [string, { original: string }][]) {
        fs.mkdirSync(path.dirname(path.join(vendor, file)), { recursive: true }); fs.writeFileSync(path.join(vendor, file), value.original);
      }
      const run = () => spawnSync(process.execPath, [script], { encoding: "utf8" });
      expect(run().status).toBe(0);
      const first = fs.readFileSync(path.join(vendor, "dist/extensions/mcp/index.js"), "utf8");
      expect(run().status).toBe(0);
      expect(fs.readFileSync(path.join(vendor, "dist/extensions/mcp/index.js"), "utf8")).toBe(first);
      expect(spawnSync(process.execPath, ["--check", path.join(vendor, "dist/extensions/mcp/index.js")]).status).toBe(0);
      fs.appendFileSync(path.join(vendor, "dist/extensions/mcp/index.js"), "\n// unexpected edit\n");
      expect(run().stderr).toContain("changed outside the verified patch");
      // 已安装版本与声明版本不等 → 拒绝。
      fs.writeFileSync(path.join(vendor, "package.json"), '{"version":"1.1.1"}');
      expect(run().stderr).toContain("require a review for Pi 1.1.1");
      // 声明写成范围而非精确版本 → 拒绝（先于版本比较，所以不用先还原上面的 1.1.1）。
      declare(`^${declaredPiVersion}`);
      expect(run().stderr).toContain("need an exact version");
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
