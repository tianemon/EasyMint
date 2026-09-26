import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { discoverAvailableExtensions, discoverPiExtensions, setPiExtensionApproved } from "./pi-extension-service";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("native Pi extension discovery", () => {
  it("lists global and project extensions without executing them, then gates changed code", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-extensions-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const projectPath = path.join(root, "project");
    const settingsDir = path.join(root, "em");
    const globalExt = path.join(nativeAgentDir, "extensions", "global.ts");
    const projectExt = path.join(projectPath, ".pi", "extensions", "project.ts");
    const marker = path.join(root, "executed");
    fs.mkdirSync(path.dirname(globalExt), { recursive: true });
    fs.mkdirSync(path.dirname(projectExt), { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(globalExt, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`);
    fs.writeFileSync(projectExt, "export default () => {};");
    const options = { nativeAgentDir, projectPath, settingsDir };
    const discovered = await discoverPiExtensions(options);
    expect(discovered.map((item) => item.name)).toEqual(["project", "global"]);
    expect(discovered.every((item) => item.status === "pending")).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.readdirSync(nativeAgentDir)).toEqual(["extensions"]);
    const global = discovered.find((item) => item.name === "global")!;
    await setPiExtensionApproved(global.id, global.fingerprint, true, options);
    expect((await discoverPiExtensions(options)).find((item) => item.id === global.id)?.status).toBe("ready");
    fs.writeFileSync(path.join(nativeAgentDir, "extensions", "unrelated.ts"), "export default () => {};");
    expect((await discoverPiExtensions(options)).find((item) => item.id === global.id)?.status).toBe("ready");
    fs.appendFileSync(globalExt, "\n// changed");
    expect((await discoverPiExtensions(options)).find((item) => item.id === global.id)?.status).toBe("pending");
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("passes only approved paths to Pi's extension loader", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-loader-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    const extension = path.join(nativeAgentDir, "extensions", "flag.ts");
    const marker = path.join(root, "loaded");
    fs.mkdirSync(path.dirname(extension), { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(extension, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'loaded'); export default () => {};`);
    const options = { nativeAgentDir, settingsDir };
    const before = await discoverPiExtensions(options);
    expect(before[0]?.status).toBe("pending");
    expect(fs.existsSync(marker)).toBe(false);
    await setPiExtensionApproved(before[0]!.id, before[0]!.fingerprint, true, options);
    const allowed = (await discoverPiExtensions(options)).filter((item) => item.status === "ready").map((item) => item.path);
    const loader = new DefaultResourceLoader({
      cwd: root, agentDir: settingsDir,
      settingsManager: SettingsManager.inMemory(),
      noExtensions: true, additionalExtensionPaths: allowed,
    });
    await loader.reload();
    expect(fs.readFileSync(marker, "utf8")).toBe("loaded");
    expect(loader.getExtensions().extensions).toHaveLength(1);
  });

  it("resolves explicit project paths and already installed Pi npm packages without installing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-packages-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const projectPath = path.join(root, "project");
    const settingsDir = path.join(root, "em");
    const piDir = path.join(projectPath, ".pi");
    const packageDir = path.join(piDir, "npm", "node_modules", "sample-pi-package");
    const gitDir = path.join(piDir, "git", "github.com", "example", "test-pi-ext");
    fs.mkdirSync(path.join(packageDir, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(gitDir, "extensions"), { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(piDir, "extra.ts"), "export default () => {};");
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ name: "sample-pi-package", version: "1.0.0", pi: { extensions: ["extensions/main.ts"] } }));
    fs.writeFileSync(path.join(packageDir, "extensions", "main.ts"), "export default () => {};");
    fs.writeFileSync(path.join(gitDir, "package.json"), JSON.stringify({ name: "test-pi-ext", version: "1.0.0", pi: { extensions: ["extensions/git.ts"] } }));
    fs.writeFileSync(path.join(gitDir, "extensions", "git.ts"), "export default () => {};");
    fs.writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({ extensions: ["./extra.ts"], packages: ["npm:sample-pi-package@1.0.0", "git:github.com/example/test-pi-ext@v1", "npm:missing-package@1.0.0"] }));
    const discovered = await discoverPiExtensions({ nativeAgentDir, projectPath, settingsDir });
    expect(discovered.filter((item) => item.status !== "missing").map((item) => item.name).sort()).toEqual(["extra", "git", "main"]);
    expect(discovered.find((item) => item.name === "npm:missing-package@1.0.0")?.status).toBe("missing");
    expect(discovered.every((item) => item.scope === "project")).toBe(true);
    expect(fs.existsSync(path.join(piDir, "npm", "node_modules", "missing-package"))).toBe(false);
    expect(fs.existsSync(nativeAgentDir)).toBe(false);
  });

  it("lets a project npm package replace the user package with the same identity", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-package-override-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const projectPath = path.join(root, "project");
    const settingsDir = path.join(root, "em");
    for (const [dir, version, entry] of [
      [path.join(nativeAgentDir, "npm", "node_modules", "override-fixture"), "1.0.0", "global.ts"],
      [path.join(projectPath, ".pi", "npm", "node_modules", "override-fixture"), "2.0.0", "project.ts"],
    ]) {
      fs.mkdirSync(path.join(dir, "extensions"), { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "override-fixture", version, pi: { extensions: [`extensions/${entry}`] } }));
      fs.writeFileSync(path.join(dir, "extensions", entry), "export default () => {};");
    }
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), JSON.stringify({ packages: ["npm:override-fixture@1.0.0"] }));
    fs.writeFileSync(path.join(projectPath, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:override-fixture@2.0.0"] }));
    const items = await discoverPiExtensions({ nativeAgentDir, projectPath, settingsDir });
    expect(items.filter((item) => item.status !== "missing").map((item) => item.name)).toEqual(["project"]);
  });

  it("applies a project autoload delta to the user package", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-package-delta-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const projectPath = path.join(root, "project");
    const settingsDir = path.join(root, "em");
    const pkg = path.join(nativeAgentDir, "npm", "node_modules", "delta-fixture");
    fs.mkdirSync(path.join(pkg, "extensions"), { recursive: true });
    fs.mkdirSync(path.join(projectPath, ".pi"), { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "delta-fixture", version: "1.0.0", pi: { extensions: ["extensions/*.ts"] } }));
    fs.writeFileSync(path.join(pkg, "extensions", "allowed.ts"), "export default () => {};");
    fs.writeFileSync(path.join(pkg, "extensions", "blocked.ts"), "export default () => {};");
    fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), JSON.stringify({ packages: ["npm:delta-fixture@1.0.0"] }));
    fs.writeFileSync(path.join(projectPath, ".pi", "settings.json"), JSON.stringify({ packages: [{ source: "npm:delta-fixture@1.0.0", autoload: false, extensions: ["-extensions/blocked.ts"] }] }));
    const items = await discoverPiExtensions({ nativeAgentDir, projectPath, settingsDir });
    expect(items.find((item) => item.name === "allowed")?.enabledInPi).toBe(true);
    expect(items.find((item) => item.name === "blocked")?.enabledInPi).toBe(false);
  });

  it("finds project packages when the native and embedded Pi config directories differ", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-config-dir-"));
    roots.push(root);
    const projectPath = path.join(root, "project");
    const pkg = path.join(projectPath, ".easymint", "npm", "node_modules", "config-dir-fixture");
    const settingsDir = path.join(root, "em");
    fs.mkdirSync(path.join(pkg, "extensions"), { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "config-dir-fixture", version: "1.0.0", pi: { extensions: ["extensions/entry.ts"] } }));
    fs.writeFileSync(path.join(pkg, "extensions", "entry.ts"), "export default () => {};");
    fs.writeFileSync(path.join(projectPath, ".easymint", "settings.json"), JSON.stringify({ packages: ["npm:config-dir-fixture@1.0.0"] }));
    const items = await discoverPiExtensions({ projectPath, nativeAgentDir: path.join(root, "pi", "agent"), settingsDir, projectConfigDir: ".easymint" });
    expect(items.find((item) => item.name === "entry")?.status).toBe("pending");
  });

  it("reports malformed native settings without preventing EM sessions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-bad-settings-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    fs.mkdirSync(nativeAgentDir, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), "{broken");
    const items = await discoverAvailableExtensions({ nativeAgentDir, settingsDir });
    expect(items).toMatchObject([{ origin: "pi", status: "error" }]);
  });

  it("respects Pi's disabled extension filter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-disabled-ext-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    const extensionDir = path.join(nativeAgentDir, "extensions");
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(extensionDir, "active.ts"), "export default () => {};");
    fs.writeFileSync(path.join(extensionDir, "blocked.ts"), "export default () => {};");
    fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), JSON.stringify({ extensions: ["!extensions/blocked.ts"] }));
    const items = await discoverPiExtensions({ nativeAgentDir, settingsDir });
    expect(items.find((item) => item.name === "active")?.enabledInPi).toBe(true);
    expect(items.find((item) => item.name === "blocked")?.enabledInPi).toBe(false);
  });

  it("shows missing explicitly configured extension files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-missing-ext-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    fs.mkdirSync(nativeAgentDir, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), JSON.stringify({ extensions: ["./gone.ts"] }));
    const items = await discoverPiExtensions({ nativeAgentDir, settingsDir });
    expect(items).toMatchObject([{ name: "gone.ts", status: "missing" }]);
  });

  it("reports an installed npm package whose version does not satisfy settings", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-version-mismatch-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    const pkg = path.join(nativeAgentDir, "npm", "node_modules", "wrong-version");
    fs.mkdirSync(path.join(pkg, "extensions"), { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "wrong-version", version: "0.9.0", pi: { extensions: ["extensions/entry.ts"] } }));
    fs.writeFileSync(path.join(pkg, "extensions", "entry.ts"), "export default () => {};");
    fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), JSON.stringify({ packages: ["npm:wrong-version@^1.0.0"] }));
    const items = await discoverPiExtensions({ nativeAgentDir, settingsDir });
    expect(items).toMatchObject([{ name: "npm:wrong-version@^1.0.0", status: "missing" }]);
    const projectPath = path.join(root, "project");
    const projectPkg = path.join(projectPath, ".pi", "npm", "node_modules", "wrong-version");
    fs.mkdirSync(path.join(projectPkg, "extensions"), { recursive: true });
    fs.writeFileSync(path.join(projectPkg, "package.json"), JSON.stringify({ name: "wrong-version", version: "0.9.0", pi: { extensions: ["extensions/project.ts"] } }));
    fs.writeFileSync(path.join(projectPkg, "extensions", "project.ts"), "export default () => {};");
    fs.writeFileSync(path.join(projectPath, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:wrong-version@^1.0.0"] }));
    const withProject = await discoverPiExtensions({ nativeAgentDir, projectPath, settingsDir });
    expect(withProject.some((item) => item.name === "project")).toBe(false);
    expect(withProject.find((item) => item.scope === "project" && item.status === "missing")?.name).toBe("npm:wrong-version@^1.0.0");
  });

  it("allows a configured extension directory with an index entry", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-dir-ext-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    const packageDir = path.join(nativeAgentDir, "my-extension");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, "index.js"), "export default () => {};");
    fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), JSON.stringify({ packages: ["./my-extension"] }));
    const options = { nativeAgentDir, settingsDir };
    const [item] = await discoverPiExtensions(options);
    expect(item).toMatchObject({ name: "my-extension", status: "pending" });
    await setPiExtensionApproved(item!.id, item!.fingerprint, true, options);
    expect((await discoverPiExtensions(options))[0]?.status).toBe("ready");
  });

  it("requires renewed approval when an installed package dependency changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-dependency-change-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    const pkg = path.join(nativeAgentDir, "npm", "node_modules", "dependency-fixture");
    const dependency = path.join(nativeAgentDir, "npm", "node_modules", "fixture-dep");
    fs.mkdirSync(path.join(pkg, "extensions"), { recursive: true });
    fs.mkdirSync(dependency, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "dependency-fixture", version: "1.0.0", dependencies: { "fixture-dep": "1.0.0" }, pi: { extensions: ["extensions/entry.ts"] } }));
    fs.writeFileSync(path.join(pkg, "extensions", "entry.ts"), "export default () => {};\n");
    fs.writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "fixture-dep", version: "1.0.0" }));
    fs.writeFileSync(path.join(dependency, "index.js"), "export default 'before';");
    fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), JSON.stringify({ packages: ["npm:dependency-fixture@1.0.0"] }));
    const options = { nativeAgentDir, settingsDir };
    const before = (await discoverPiExtensions(options)).find((item) => item.name === "entry")!;
    await setPiExtensionApproved(before.id, before.fingerprint, true, options);
    fs.writeFileSync(path.join(dependency, "index.js"), "export default 'after';");
    expect((await discoverPiExtensions(options)).find((item) => item.name === "entry")?.status).toBe("pending");
  });

  it("applies project Pi exclusions to its auto-discovered directory", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-project-disabled-"));
    roots.push(root);
    const projectPath = path.join(root, "project");
    const piDir = path.join(projectPath, ".pi");
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    fs.mkdirSync(path.join(piDir, "extensions"), { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(piDir, "extensions", "active.ts"), "export default () => {};");
    fs.writeFileSync(path.join(piDir, "extensions", "blocked.ts"), "export default () => {};");
    fs.writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({ extensions: ["!extensions/blocked.ts"] }));
    const items = await discoverPiExtensions({ projectPath, nativeAgentDir, settingsDir });
    expect(items.find((item) => item.name === "active")?.enabledInPi).toBe(true);
    expect(items.find((item) => item.name === "blocked")?.enabledInPi).toBe(false);
    const emDir = path.join(projectPath, ".easymint");
    fs.mkdirSync(path.join(emDir, "extensions"), { recursive: true });
    fs.writeFileSync(path.join(emDir, "extensions", "em-active.ts"), "export default () => {};");
    fs.writeFileSync(path.join(emDir, "extensions", "em-blocked.ts"), "export default () => {};");
    fs.writeFileSync(path.join(emDir, "settings.json"), JSON.stringify({ extensions: ["!extensions/em-blocked.ts"] }));
    const mismatched = await discoverPiExtensions({ projectPath, nativeAgentDir, settingsDir, projectConfigDir: ".easymint" });
    expect(mismatched.find((item) => item.name === "em-active")?.enabledInPi).toBe(true);
    expect(mismatched.find((item) => item.name === "em-blocked")?.enabledInPi).toBe(false);
  });

  it("requires renewed approval when a bare package dependency of a single-file extension changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-single-dep-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    const extension = path.join(nativeAgentDir, "extensions", "demo.ts");
    const dependency = path.join(nativeAgentDir, "node_modules", "demo-dep");
    fs.mkdirSync(path.dirname(extension), { recursive: true });
    fs.mkdirSync(dependency, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(extension, `import { value } from "demo-dep";\nexport default () => value;\n`);
    fs.writeFileSync(path.join(dependency, "package.json"), JSON.stringify({ name: "demo-dep", version: "1.0.0" }));
    fs.writeFileSync(path.join(dependency, "index.js"), "export const value = 'before';");
    const options = { nativeAgentDir, settingsDir };
    const before = (await discoverPiExtensions(options)).find((item) => item.name === "demo")!;
    expect(before.status).toBe("pending");
    await setPiExtensionApproved(before.id, before.fingerprint, true, options);
    // 依赖不变 → 授权保留
    expect((await discoverPiExtensions(options)).find((item) => item.id === before.id)?.status).toBe("ready");
    // 其他扩展的无关文件变动不撤销授权
    fs.writeFileSync(path.join(nativeAgentDir, "extensions", "unrelated.ts"), "export default () => {};");
    expect((await discoverPiExtensions(options)).find((item) => item.id === before.id)?.status).toBe("ready");
    // 裸包名依赖源码变更 → 指纹变化，状态回到待确认
    fs.writeFileSync(path.join(dependency, "index.js"), "export const value = 'after';");
    expect((await discoverPiExtensions(options)).find((item) => item.id === before.id)?.status).toBe("pending");
  });

  it("enables extensions whose imports cannot be statically resolved (best-effort fingerprint)", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-unresolvable-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    const extensionDir = path.join(nativeAgentDir, "extensions");
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    // 注释里的 require(...) 不再触发「动态导入」拒绝（正则会匹配注释文本）
    fs.writeFileSync(path.join(extensionDir, "commented.ts"), "// Example: require(dynamic)\nexport default () => {};\n");
    // 定位不到的裸包名（Pi 运行时可能动态解析）：不拒绝启用
    fs.writeFileSync(path.join(extensionDir, "missing-dep.ts"), `import { x } from "dep-not-installed-anywhere";\nexport default () => x;\n`);
    // 协议前缀导入：跳过（jiti 运行时自会失败）
    fs.writeFileSync(path.join(extensionDir, "remote.ts"), `import x from "https://example.com/x.js";\nexport default () => x;\n`);
    const items = await discoverPiExtensions({ nativeAgentDir, settingsDir });
    for (const name of ["commented", "missing-dep", "remote"]) {
      const item = items.find((entry) => entry.name === name)!;
      expect(item.status).toBe("pending");
      expect(item.error).toBeUndefined();
    }
  });

  it("accepts imports of modules provided by Pi (typebox, legacy scopes) without error", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-provided-modules-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const settingsDir = path.join(root, "em");
    const extensionDir = path.join(nativeAgentDir, "extensions");
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    // Pi 经 jiti 别名提供的模块（loader.js getAliases）：SDK 固定版本提供，不按用户依赖定位
    fs.writeFileSync(path.join(extensionDir, "typebox.ts"), `import { Type } from "typebox";\nimport { Compile } from "typebox/compile";\nimport { Value } from "@sinclair/typebox/value";\nexport default () => Type.String();\n`);
    fs.writeFileSync(path.join(extensionDir, "legacy.ts"), `import { pi } from "@mariozechner/pi-ai";\nimport { core } from "@mariozechner/pi-agent-core";\nexport default () => pi ?? core;\n`);
    fs.writeFileSync(path.join(extensionDir, "current.ts"), `import { tools } from "@earendil-works/pi-coding-agent";\nexport default () => tools;\n`);
    const items = await discoverPiExtensions({ nativeAgentDir, settingsDir });
    for (const name of ["typebox", "legacy", "current"]) {
      const item = items.find((entry) => entry.name === name)!;
      expect(item.status).toBe("pending");
      expect(item.error).toBeUndefined();
    }
  });

  it("resolves Pi git shorthand to the same identity and install path as full URLs", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-git-shorthand-"));
    roots.push(root);
    const nativeAgentDir = path.join(root, "pi", "agent");
    const projectPath = path.join(root, "project");
    const settingsDir = path.join(root, "em");
    const piDir = path.join(projectPath, ".pi");
    const gitDir = path.join(piDir, "git", "github.com", "example", "test-pi-ext");
    fs.mkdirSync(path.join(gitDir, "extensions"), { recursive: true });
    fs.mkdirSync(nativeAgentDir, { recursive: true });
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, "package.json"), JSON.stringify({ name: "test-pi-ext", version: "1.0.0", pi: { extensions: ["extensions/git.ts"] } }));
    fs.writeFileSync(path.join(gitDir, "extensions", "git.ts"), "export default () => {};");
    // 原生 Pi 可解析的简写，EM 不得误判缺失
    fs.writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({ packages: ["git:github:example/test-pi-ext"] }));
    const items = await discoverPiExtensions({ nativeAgentDir, projectPath, settingsDir });
    expect(items.find((item) => item.name === "git")?.status).toBe("pending");
    expect(items.some((item) => item.status === "missing")).toBe(false);
    // 同仓库的不同 URL 写法（简写 / host 路径 / HTTPS / SSH）产生相同身份 → 项目条目按覆盖规则去重
    for (const source of ["git:github:example/test-pi-ext", "git:github.com/example/test-pi-ext@v1",
      "https://github.com/example/test-pi-ext.git", "git:git@github.com:example/test-pi-ext.git", "ssh://git@github.com/example/test-pi-ext"]) {
      fs.writeFileSync(path.join(nativeAgentDir, "settings.json"), JSON.stringify({ packages: [source] }));
      fs.writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({ packages: ["git:github.com/example/test-pi-ext@v1"] }));
      const deduped = await discoverPiExtensions({ nativeAgentDir, projectPath, settingsDir });
      expect(deduped.filter((item) => item.name === "git")).toHaveLength(1);
      expect(deduped.find((item) => item.name === "git")?.scope).toBe("project");
      expect(deduped.some((item) => item.status === "missing")).toBe(false);
    }
    // 非法遍历路径仍被拒绝（显示缺失，不拼出安装路径）
    fs.rmSync(path.join(nativeAgentDir, "settings.json"), { force: true });
    fs.writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({ packages: ["git:github.com/../evil"] }));
    const invalid = await discoverPiExtensions({ nativeAgentDir, projectPath, settingsDir });
    expect(invalid.find((item) => item.name === "git")).toBeUndefined();
    expect(invalid.some((item) => item.status === "missing" && item.name.includes("evil"))).toBe(true);
  });

  it("pins the Pi Git parser contract to the locked SDK version", async () => {
    // 升级 @earendil-works/pi-coding-agent 时本测试刻意失败：必须复核 dist/utils/git.js 的
    // parseGitUrl 行为（EM 经内部入口直接复用该文件，见 pi-extension-service.ensurePiGitParser）
    const require = createRequire(path.join(__dirname, "anchor.cjs"));
    const manifestPath = (require.resolve.paths("@earendil-works/pi-coding-agent") ?? [])
      .map((root) => path.join(root, "@earendil-works", "pi-coding-agent", "package.json"))
      .find((file) => fs.existsSync(file));
    expect(manifestPath).toBeDefined();
    expect(JSON.parse(fs.readFileSync(manifestPath!, "utf8")).version).toBe("0.87.1");
    const { parseGitUrl } = await import(pathToFileURL(path.join(path.dirname(manifestPath!), "dist", "utils", "git.js")).href);
    const forms = ["git:github:owner/repo", "git:github.com/owner/repo@tag", "https://github.com/owner/repo.git", "git:git@github.com:owner/repo.git"];
    const identities = forms.map((source) => {
      const parsed = parseGitUrl(source);
      return parsed ? `${parsed.host}/${parsed.path}` : null;
    });
    expect(identities).toEqual(["github.com/owner/repo", "github.com/owner/repo", "github.com/owner/repo", "github.com/owner/repo"]);
    expect(parseGitUrl("git:github.com/../evil")).toBeNull();
  });
});
