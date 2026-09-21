import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeConfig } from "./native-config";
import { Store } from "./store";
import { atomicWrite, encode } from "./native-config-storage";
vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => os.tmpdir() } }));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
describe("pi import", () => {
  it("previews without writing, imports once, keeps conflicts and transcripts, and seeds session model state", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-import-")); roots.push(root);
    const source = path.join(root, "pi", "agent"); const target = path.join(root, "em");
    const store = new Store(target); const repo = await NativeConfig.create(store);
    const native = { providers: { local: { api: "openai-completions", baseUrl: "http://localhost:1234/v1", models: [{ id: "m", name: "M", contextWindow: 30000, maxTokens: 4000 }] } } };
    atomicWrite(path.join(source, "models.json"), encode(native));
    atomicWrite(path.join(source, "auth.json"), encode({ local: { type: "api_key", key: "source-test" } }));
    atomicWrite(path.join(source, "settings.json"), encode({ defaultProvider: "local", defaultModel: "m", defaultThinkingLevel: "high", extensions: ["./do-not-load.js"], sessionDir: "/do-not-use" }));
    const cwd = path.join(root, "project");
    const transcript = [
      { type: "session", version: 3, id: "session-one", cwd, timestamp: new Date().toISOString() },
      { type: "model_change", id: "a", parentId: null, provider: "local", modelId: "m", timestamp: new Date().toISOString() },
      { type: "thinking_level_change", id: "b", parentId: "a", thinkingLevel: "low", timestamp: new Date().toISOString() },
      { type: "session_info", id: "c", parentId: "b", name: "Imported", timestamp: new Date().toISOString() },
    ].map(x => JSON.stringify(x)).join("\n") + "\n";
    const relative = path.join(`--${cwd.slice(1).replaceAll("/", "-")}--`, "session-one.jsonl");
    atomicWrite(path.join(source, "sessions", relative), transcript);
    const preview = await repo.importPi(source);
    expect(preview).toMatchObject({ providers: 1, sessions: 1, projects: 1, providerConflictSessions: 0, skippedSettings: ["extensions", "sessionDir"] });
    expect(fs.existsSync(repo.files.models)).toBe(false);
    expect(fs.existsSync(path.join(target, "agent", "sessions"))).toBe(false);
    await repo.importPi(source, true);
    expect(read(repo.files.settings)).toEqual({ defaultProvider: "local", defaultModel: "m", defaultThinkingLevel: "high" });
    expect(read(path.join(target, "session-cache", "session-one.json"))).toMatchObject({ provider: "local", model: "m", thinkingLevel: "low" });
    expect(fs.readFileSync(path.join(target, "agent", "sessions", relative), "utf8")).toBe(transcript);
    expect(fs.readFileSync(path.join(source, "sessions", relative), "utf8")).toBe(transcript);
    const again = await repo.importPi(source, true);
    expect(again).toMatchObject({ providers: 0, sessions: 0, projects: 0, conflicts: 1, duplicates: 1 });
    expect(read(repo.files.auth).local.key).toBe("source-test");
    expect(read(path.join(target, "projects.json")).projects).toHaveLength(1);
  }, 60000);

  it("skips sessions whose provider ID collides with an existing provider", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-import-conflict-")); roots.push(root);
    const source = path.join(root, "pi", "agent"); const target = path.join(root, "em");
    const local = { id: "local", presetId: "custom", name: "EM Local", apiKey: "em-key", model: "m", models: ["m"], createdAt: 1,
      baseUrl: "http://em.example/v1", apiType: "openai-completions",
      extraModels: [{ id: "m", name: "M", contextWindow: 30000, maxTokens: 4000 }] };
    const store = new Store(target);
    atomicWrite(path.join(target, "em-settings.json"), encode({ apiProviders: { current: "local", configs: { local } } }));
    const repo = await NativeConfig.create(store);
    atomicWrite(path.join(source, "models.json"), encode({ providers: { local: {
      api: "openai-completions", baseUrl: "http://pi.example/v1",
      models: [{ id: "m", name: "M", contextWindow: 30000, maxTokens: 4000 }],
    } } }));
    atomicWrite(path.join(source, "auth.json"), encode({ local: { type: "api_key", key: "pi-key" } }));
    const cwd = path.join(root, "project");
    const transcript = [
      { type: "session", version: 3, id: "conflicted-session", cwd, timestamp: new Date().toISOString() },
      { type: "model_change", id: "a", parentId: null, provider: "local", modelId: "m", timestamp: new Date().toISOString() },
    ].map(x => JSON.stringify(x)).join("\n") + "\n";
    atomicWrite(path.join(source, "sessions", "--project--", "conflicted-session.jsonl"), transcript);
    const result = await repo.importPi(source, true);
    expect(result).toMatchObject({ providers: 0, sessions: 0, providerConflictSessions: 1 });
    expect(read(repo.files.models).providers.local.baseUrl).toBe("http://em.example/v1");
    expect(fs.existsSync(path.join(target, "agent", "sessions", "--project--", "conflicted-session.jsonl"))).toBe(false);
  }, 60000);

  it("deduplicates against existing sessions and never overwrites corrupt targets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-import-idx-")); roots.push(root);
    const source = path.join(root, "pi", "agent"); const target = path.join(root, "em");
    const store = new Store(target); const repo = await NativeConfig.create(store);
    const cwd = path.join(root, "project");
    const dirName = `--${cwd.slice(1).replaceAll("/", "-")}--`;
    const transcript = [
      { type: "session", version: 3, id: "dup-one", cwd, timestamp: new Date().toISOString() },
      { type: "model_change", id: "a", parentId: null, provider: "local", modelId: "m", timestamp: new Date().toISOString() },
    ].map(x => JSON.stringify(x)).join("\n") + "\n";
    // EM 已有一份同 id 同内容的会话
    atomicWrite(path.join(target, "agent", "sessions", dirName, "dup-one.jsonl"), transcript);
    // 目标落点放一个损坏文件：另一个源会话会落到同一路径（不进索引 → 回读全文兜底比对）
    atomicWrite(path.join(target, "agent", "sessions", dirName, "dup-two.jsonl"), "not-jsonl");
    const second = [
      { type: "session", version: 3, id: "dup-two", cwd, timestamp: new Date().toISOString() },
      { type: "model_change", id: "a", parentId: null, provider: "local", modelId: "m", timestamp: new Date().toISOString() },
    ].map(x => JSON.stringify(x)).join("\n") + "\n";
    atomicWrite(path.join(source, "sessions", dirName, "dup-one.jsonl"), transcript);
    atomicWrite(path.join(source, "sessions", dirName, "dup-two.jsonl"), second);
    const result = await repo.importPi(source, true);
    // 同 id 同内容 → duplicate；落点被损坏文件占住（内容不同）→ conflict，均不导入
    expect(result).toMatchObject({ sessions: 0, duplicates: 1, conflicts: 1 });
    expect(fs.readFileSync(path.join(target, "agent", "sessions", dirName, "dup-two.jsonl"), "utf8")).toBe("not-jsonl");
  }, 60000);

  it("probe reports existence without reading session contents", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-probe-")); roots.push(root);
    const source = path.join(root, "pi", "agent"); const target = path.join(root, "em");
    const store = new Store(target); const repo = await NativeConfig.create(store);
    expect((await repo.importPi(source, false, true)).found).toBe(false);
    atomicWrite(path.join(source, "sessions", "--x--", "s.jsonl"), "garbage-not-json");
    const probe = await repo.importPi(source, false, true);
    expect(probe).toMatchObject({ found: true, providers: 0, sessions: 0 });
  });
});
