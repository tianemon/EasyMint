import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { shell } from "electron";
import { Store } from "./store";
import { resolveHome } from "../utils/paths";

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  status: "setup" | "development" | "completed";
  description: string;
}

function getTemplateDir(): string {
  // Production: template is bundled as extraResource
  // process.resourcesPath exists only in Electron, not in plain Node/vitest
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, "template");
    if (fs.existsSync(bundled)) return bundled;
  }
  // Development: __dirname = app/main/dist → up 3 levels to project root → template/
  return path.resolve(__dirname, "..", "..", "..", "template");
}

export class ProjectService {
  private templateDir: string;

  constructor(private store: Store, templateDir?: string) {
    this.templateDir = templateDir ?? getTemplateDir();
  }

  list(): Array<Project & { exists: boolean }> {
    return this.store.getProjects().map((p) => ({
      ...p,
      exists: fs.existsSync(p.path),
    }));
  }

  create(opts: { name: string; path: string }): Project {
    const projects = this.store.getProjects();
    const basePath = resolveHome(opts.path);
    const resolvedPath = path.resolve(basePath, opts.name);
    const project: Project = {
      id: randomUUID(),
      name: opts.name,
      path: resolvedPath,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      status: "setup",
      description: "",
    };

    const targetDir = resolvedPath;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    this.copyTemplate(targetDir);

    projects.push(project);
    this.store.saveProjects(projects);
    return project;
  }

  async delete(id: string): Promise<void> {
    const project = this.store.getProjects().find((p) => p.id === id);
    if (project) {
      if (fs.existsSync(project.path)) {
        await shell.trashItem(project.path);
      }
      // Clean up SDK session directory
      const sdkProjectsDir = path.join(os.homedir(), ".easymint", "projects");
      const encodedPath = project.path.replace(/[:/\\]/g, "-");
      const sdkDir = path.join(sdkProjectsDir, encodedPath);
      if (fs.existsSync(sdkDir)) fs.rmSync(sdkDir, { recursive: true, force: true });
    }
    const projects = this.store.getProjects().filter((p) => p.id !== id);
    this.store.saveProjects(projects);
  }

  get(id: string): (Project & { exists: boolean }) | undefined {
    const p = this.store.getProjects().find((p) => p.id === id);
    if (!p) return undefined;
    return { ...p, exists: fs.existsSync(p.path) };
  }

  /** 更新项目名称/路径，路径变更时自动迁移 SDK session 数据 */
  update(id: string, patch_: { name?: string; path?: string }): (Project & { exists: boolean }) | undefined {
    const project = this.store.getProjects().find((p) => p.id === id);
    if (!project) return undefined;

    // 规范化路径后再比较和存储
    const patch: { name?: string; path?: string } = { ...patch_ };
    if (patch.path) patch.path = path.resolve(patch.path);

    // 路径变更 → 迁移 SDK session 目录
    if (patch.path && patch.path !== project.path) {
      const sdkDir = path.join(os.homedir(), ".easymint", "projects");
      const oldEncoded = project.path.replace(/[:/\\]/g, "-");
      const newEncoded = patch.path.replace(/[:/\\]/g, "-");
      const oldDir = path.join(sdkDir, oldEncoded);
      const newDir = path.join(sdkDir, newEncoded);
      if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        fs.renameSync(oldDir, newDir);
      }
    }

    const updated = this.store.updateProject(id, patch);
    if (!updated) return undefined;

    return { ...updated, exists: fs.existsSync(updated.path) };
  }

  /** 导入已有目录为项目（不复制 template，目录已存在） */
  import_(dirPath: string): (Project & { exists: boolean; isNew: boolean }) {
    const resolved = path.resolve(dirPath);

    // 已有记录的：更新 lastOpenedAt 并返回
    const existing = this.store.getProjects().find(
      (p) => path.resolve(p.path) === resolved
    );
    if (existing) {
      const updated = this.store.updateProject(existing.id, {});
      return { ...updated!, exists: true, isNew: false };
    }

    // 新目录：创建项目记录（不建目录、不复制模板）
    const project: Project = {
      id: randomUUID(),
      name: path.basename(resolved),
      path: resolved,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      status: "setup",
      description: "",
    };
    const projects = this.store.getProjects();
    projects.push(project);
    this.store.saveProjects(projects);
    return { ...project, exists: true, isNew: true };
  }

  /** 重命名项目：复制→更新记录→写清理任务。由调用方负责 app.relaunch/quit */
  async rename(oldDir: string, newName: string): Promise<{ ok: boolean; error?: string }> {
    const parentDir = path.dirname(oldDir);
    const newDir = path.join(parentDir, newName);

    if (path.basename(oldDir) === newName) return { ok: false, error: "新名称与当前名称相同" };
    if (fs.existsSync(newDir)) return { ok: false, error: `目标目录已存在: ${newDir}` };
    if (!fs.existsSync(oldDir)) return { ok: false, error: `项目目录不存在: ${oldDir}` };

    const newSessDir = path.join(os.homedir(), ".easymint", "projects",
      newDir.replace(/[:\\/]/g, "-"));

    // 失败时清理半成品
    const cleanup = () => {
      try { if (fs.existsSync(newDir)) fs.rmSync(newDir, { recursive: true, force: true }); } catch { /* best effort */ }
      try { if (fs.existsSync(newSessDir)) fs.rmSync(newSessDir, { recursive: true, force: true }); } catch { /* best effort */ }
    };

    try {
      const { cp } = await import("node:fs/promises");

      // 复制项目目录
      await cp(oldDir, newDir, { recursive: true });

      // 复制 SDK session
      const oldSessDir = path.join(os.homedir(), ".easymint", "projects",
        oldDir.replace(/[:\\/]/g, "-"));
      if (fs.existsSync(oldSessDir)) {
        await cp(oldSessDir, newSessDir, { recursive: true });
      }

      // 更新 projects.json
      const projectsPath = path.join(os.homedir(), ".easymint", "projects.json");
      if (fs.existsSync(projectsPath)) {
        const data = JSON.parse(fs.readFileSync(projectsPath, "utf-8"));
        const found = (data.projects as Array<Record<string, unknown>>).find((prj) => {
          const p1 = String(prj.path || "").replace(/\/+$/, "");
          const p2 = oldDir.replace(/\/+$/, "");
          return p1 === p2 || p1 === oldDir;
        });
        if (found) {
          found.name = newName;
          found.path = newDir;
          found.lastOpenedAt = new Date().toISOString();
        }
        fs.writeFileSync(projectsPath, JSON.stringify(data, null, 2));
      }

      // 更新新目录下 package.json 的 name
      const newPkgPath = path.join(newDir, "package.json");
      if (fs.existsSync(newPkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(newPkgPath, "utf-8"));
          if (pkg.name && pkg.name !== newName) {
            pkg.name = newName;
            fs.writeFileSync(newPkgPath, JSON.stringify(pkg, null, 2) + "\n");
          }
        } catch { /* skip */ }
      }

      // 写清理任务
      const cleanFile = path.join(os.homedir(), ".easymint", ".cleanup-pending.json");
      const cleanTask = { oldDir, oldSessionDir: oldSessDir, timestamp: Date.now() };
      const cleanTasks = fs.existsSync(cleanFile)
        ? (() => { try { return JSON.parse(fs.readFileSync(cleanFile, "utf-8")); } catch { return []; } })()
        : [];
      cleanTasks.push(cleanTask);
      fs.writeFileSync(cleanFile, JSON.stringify(cleanTasks, null, 2));

      return { ok: true };
    } catch (e) {
      cleanup();
      return { ok: false, error: `复制失败: ${(e as Error).message}` };
    }
  }

  private copyTemplate(targetDir: string): void {
    const exclude = new Set([".git", "node_modules", ".DS_Store", ".playwright-mcp", "temp"]);
    const entries = fs.readdirSync(this.templateDir);
    for (const entry of entries) {
      if (exclude.has(entry)) continue;
      const src = path.join(this.templateDir, entry);
      const dest = path.join(targetDir, entry);
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }
    fs.mkdirSync(path.join(targetDir, "temp"), { recursive: true });
  }
}
