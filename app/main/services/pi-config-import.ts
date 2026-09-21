/** One-time copy, never a shared agentDir. Existing EM values win on collisions. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { NativeConfig } from "./native-config";
import { readText, type JsonObject } from "./native-config-storage";
import type { PiImportSummary } from "../../shared/pi-config-import";
import { getSessionDataHelpers } from "./pi-sdk";
import { THINKING_ORDER } from "../../shared/thinking-levels";

function sessionsIn(root: string, maxVersion: number): { files: Array<{ relative: string; text: string; id: string; cwd: string }>; invalid: number } {
  const files: Array<{ relative: string; text: string; id: string; cwd: string }> = [];
  let invalid = 0;
  if (!fs.existsSync(root)) return { files, invalid };
  // Native pi sessions are one directory deep. Do not follow symlinks or import executable resources.
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const entry of fs.readdirSync(path.join(root, dir.name), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const relative = path.join(dir.name, entry.name);
      try {
        const text = fs.readFileSync(path.join(root, relative), "utf8");
        const header = JSON.parse(text.split("\n", 1)[0]!);
        if (!Number.isInteger(header.version ?? 1) || (header.version ?? 1) < 1 || (header.version ?? 1) > maxVersion) throw new Error("unsupported session version");
        if (header.type !== "session" || typeof header.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(header.id) || typeof header.cwd !== "string" || !path.isAbsolute(header.cwd)) throw new Error("invalid header");
        // Validate the parent graph before handing it to the SDK's tree traversal.
        const rows = text.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
        if (rows.some(row => !row || typeof row.type !== "string" || row.type === "message" && !row.message)) throw new Error("invalid entry");
        if (header.version >= 2) {
          const index = new Map<string, JsonObject>();
          for (const row of rows.slice(1)) {
            if (typeof row.id !== "string" || index.has(row.id)) throw new Error("invalid entry id");
            index.set(row.id, row);
          }
          const done = new Set<string>();
          for (const id of index.keys()) {
            const branch = new Set<string>();
            let current: string | undefined = id;
            while (current && index.has(current) && !done.has(current)) {
              if (branch.has(current)) throw new Error("cyclic session");
              branch.add(current); current = index.get(current)!.parentId;
            }
            for (const visited of branch) done.add(visited);
          }
        }
        files.push({ relative, text, id: header.id, cwd: header.cwd });
      } catch { invalid++; }
    }
  }
  return { files, invalid };
}

export async function buildPiImport(repo: NativeConfig, sourceDir: string) {
  sourceDir = path.resolve(sourceDir);
  if (sourceDir === path.resolve(repo.storage.agentDir)) throw new Error("不能从 EM 自己的配置目录导入");
  const source = (name: string) => repo.storage.read(path.join(sourceDir, `${name}.json`));
  const models = source("models");
  if (Object.keys(models).length) await repo.storage.validateModels(models);
  const auth = source("auth");
  for (const credential of Object.values(auth)) {
    if (!credential || !["api_key", "oauth"].includes(credential.type) ||
        credential.type === "api_key" && typeof credential.key !== "string" ||
        credential.type === "oauth" && (typeof credential.access !== "string" || typeof credential.refresh !== "string" || typeof credential.expires !== "number")) {
      throw new Error("pi 凭据格式无效，未导入");
    }
  }
  const settings = source("settings");
  for (const key of ["defaultProvider", "defaultModel"]) if (settings[key] !== undefined && typeof settings[key] !== "string") throw new Error(`pi ${key} 无效`);
  if (settings.defaultThinkingLevel !== undefined && !(THINKING_ORDER as readonly unknown[]).includes(settings.defaultThinkingLevel)) throw new Error("pi 默认思考等级无效");
  const sessionHelpers = await getSessionDataHelpers();
  const sessionSource = sessionsIn(path.join(sourceDir, "sessions"), sessionHelpers.currentVersion);
  const existingSessions = sessionsIn(path.join(repo.storage.agentDir, "sessions"), sessionHelpers.currentVersion);
  const existingIds = new Map(existingSessions.files.map(s => [s.id, s.text]));
  const currentModels = repo.storage.read(repo.files.models); currentModels.providers ??= {};
  const currentAuth = repo.storage.read(repo.files.auth);
  const currentSettings = repo.storage.read(repo.files.settings);
  const projectsFile = path.join(repo.store.getDataDir(), "projects.json");
  const projectData = repo.storage.read(projectsFile); projectData.projects ??= [];
  if (!Array.isArray(projectData.projects)) throw new Error("EM 项目列表格式无效");
  const originals = new Map([...Object.values(repo.files), projectsFile].map(file => [file, readText(file)]));
  const existingProviders = new Set(Object.keys(repo.view().apiProviders.configs));
  const providerIds = new Set([...Object.keys(models.providers ?? {}), ...Object.keys(auth)]);
  const providerConflicts = new Set<string>();
  const supportedSettings = ["defaultProvider", "defaultModel", "defaultThinkingLevel"];
  const summary: PiImportSummary = {
    sourceDir, found: providerIds.size > 0 || sessionSource.files.length > 0 || supportedSettings.some(key => settings[key] !== undefined),
    providers: 0, sessions: 0, projects: 0, conflicts: 0, duplicates: 0, invalidSessions: sessionSource.invalid,
    providerConflictSessions: 0,
    oauth: Object.values(auth).some(c => c.type === "oauth"), skippedSettings: Object.keys(settings).filter(key => !supportedSettings.includes(key)),
  };
  for (const id of providerIds) {
    if (existingProviders.has(id)) { providerConflicts.add(id); summary.conflicts++; continue; }
    if (models.providers?.[id]) currentModels.providers[id] = models.providers[id];
    if (auth[id]) currentAuth[id] = auth[id];
    summary.providers++;
  }
  // Defaults form a pair: never import only half of a provider/model selection.
  if (!currentSettings.defaultProvider && !currentSettings.defaultModel) {
    if (settings.defaultProvider !== undefined) currentSettings.defaultProvider = settings.defaultProvider;
    if (settings.defaultModel !== undefined) currentSettings.defaultModel = settings.defaultModel;
  } else if (settings.defaultProvider && (settings.defaultProvider !== currentSettings.defaultProvider || settings.defaultModel !== currentSettings.defaultModel)) summary.conflicts++;
  if (currentSettings.defaultThinkingLevel === undefined && settings.defaultThinkingLevel !== undefined) currentSettings.defaultThinkingLevel = settings.defaultThinkingLevel;
  const sessions = new Map<string, string>();
  const cacheFiles = new Map<string, JsonObject>();
  const projects = new Set(projectData.projects.map((p: JsonObject) => path.resolve(p.path)));
  for (const session of sessionSource.files) {
    const target = path.join(repo.storage.agentDir, "sessions", session.relative);
    const existing = existingIds.get(session.id) ?? readText(target);
    if (existing != null) {
      if (existing === session.text) summary.duplicates++; else summary.conflicts++;
      continue;
    }
    const entries = sessionHelpers.parseSessionEntries(session.text);
    sessionHelpers.migrateSessionEntries(entries);
    const context = sessionHelpers.buildSessionContext(entries.filter(entry => entry.type !== "session"));
    // 同 ID 自定义供应商可能指向完全不同的端点。不能导入会被现有配置重新解释的会话。
    if (context.model && providerConflicts.has(context.model.provider)) {
      summary.providerConflictSessions++;
      summary.conflicts++;
      continue;
    }
    sessions.set(target, session.text); originals.set(target, null); existingIds.set(session.id, session.text); summary.sessions++;
    const cacheFile = path.join(repo.store.getDataDir(), "session-cache", `${session.id}.json`);
    if (readText(cacheFile) === null) {
      originals.set(cacheFile, null);
      cacheFiles.set(cacheFile, { permissionMode: "standard", contextUsage: 0, updatedAt: Date.now(),
        ...(context.model ? { provider: context.model.provider, model: context.model.modelId } : {}), thinkingLevel: context.thinkingLevel });
    }
    const cwd = path.resolve(session.cwd);
    if (!projects.has(cwd)) {
      projects.add(cwd); summary.projects++;
      projectData.projects.push({ id: randomUUID(), name: path.basename(cwd) || cwd, path: cwd,
        createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString(), status: "development", description: "" });
    }
  }
  await repo.storage.validateModels(currentModels);
  const values = new Map<string, JsonObject>(cacheFiles);
  if (summary.providers) { values.set(repo.files.models, currentModels); values.set(repo.files.auth, currentAuth); }
  if (supportedSettings.some(key => currentSettings[key] !== undefined)) values.set(repo.files.settings, currentSettings);
  if (summary.projects) values.set(projectsFile, projectData);
  return { summary, values, originals, sessions };
}
