import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
});
