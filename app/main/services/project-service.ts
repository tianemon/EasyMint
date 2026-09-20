import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { shell } from "electron";
import { Store } from "./store";
import { resolveHome } from "../utils/paths";
// 会话目录工具用静态导入：本模块只依赖 pi-sdk 的**类型**（运行时零负担），比 `require` 更可靠
// —— `update()` 是同步入口，原先用 `require("./pi-session")`，而 require 在测试环境解析不了，
// 导致这段路径「测不到」，2026-09-20 的 mkdir 副作用缺陷正是这样溜过去的。
import {
  ensureSessionManagerClass,
  getPiSessionDir,
  isEmptyDirShell,
  moveSessionDir,
  tryGetPiSessionDir,
} from "./pi-session-dir";

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

/**
 * 会话目录改名的**延后补偿**。
 *
 * `ProjectService.update()` 是同步入口（改项目路径的记录更新），不能 await 启动期的
 * 「SDK 预热 + 旧目录迁移」（首次 dynamic import SDK 冷启实测 7~10 秒）。而路径变更后会话目录名按
 * **新** cwd 编码，旧目录不会自己跟过来——若预热未完成时直接跳过，这次路径变更会让历史会话
 * 在新路径下**永久不可见**（正是本次会话目录对齐要修的那类现象），且启动期的旧目录迁移也补不了
 * （它按会话文件首行 cwd 重算目录名，文件里的 cwd 仍是旧值）。
 * 故此处把改名挂到预热完成之后补做；预热失败只记日志（下次路径变更会再触发一次）。
 */
function deferSessionDirRename(oldCwd: string, newCwd: string): void {
  void (async () => {
    const { moveSessionDir, primeSessionManagerClass } = await import("./pi-session-dir");
    try {
      await primeSessionManagerClass();
    } catch (e) {
      console.warn("[project] 会话目录延后改名未执行（SDK 预热失败）:", (e as Error).message);
      return;
    }
    try {
      const action = moveSessionDir(oldCwd, newCwd);
      if (action !== "noop") console.log(`[project] 会话目录已延后${action === "moved" ? "改名" : "并入"}：${oldCwd} → ${newCwd}`);
    } catch (e) {
      console.warn("[project] 会话目录延后改名失败:", (e as Error).message);
    }
  })();
}

/** lastOpenedAt → 时间戳。缺失/非法（旧数据、手改过的 json）一律当 0 排到最后，避免 NaN 打乱顺序 */
export function openedAt(p: { lastOpenedAt?: string }): number {
  const t = Date.parse(p.lastOpenedAt ?? "");
  return Number.isNaN(t) ? 0 : t;
}

export class ProjectService {
  private templateDir: string;

  constructor(private store: Store, templateDir?: string) {
    this.templateDir = templateDir ?? getTemplateDir();
  }

  list(): Array<Project & { exists: boolean }> {
    // 系统 workspace 目录不是用户项目，过滤掉防止误删
    const settings = this.store.getSettings();
    const base = resolveHome(settings.defaultProjectDir || "~/EasyMintProject");
    const workspaceDir = path.resolve(base, "workspace");
    return this.store.getProjects()
      .filter((p) => path.resolve(p.path) !== workspaceDir)
      .map((p) => ({
        ...p,
        exists: fs.existsSync(p.path),
      }))
      // 最近打开在前（打开项目弹窗的默认顺序）。排序放这里，UI 与其它调用方共用同一顺序。
      // sort 稳定(ES2019+)：lastOpenedAt 相同的按 projects.json 原有顺序，不会来回抖
      .sort((a, b) => openedAt(b) - openedAt(a));
  }

  create(opts: { name: string; path: string }): Project {
    const projects = this.store.getProjects();
    const basePath = resolveHome(opts.path);
    // 名称含路径分隔符会解析成嵌套目录（用户可能从翻译/粘贴带入）——先拒绝再解析
    if (/[\\/]/.test(opts.name)) {
      throw new Error(`项目名称不能包含路径分隔符：${opts.name}`);
    }
    const resolvedPath = path.resolve(basePath, opts.name);
    const targetDir = resolvedPath;
    // 目录冲突防护：已存在且非空 = 拒绝创建——静默把模板合进既有目录会造成不可逆数据污染
    //（曾发生：重复创建同名项目 → 旧内容混入模板；空目录已存在则允许（可复用预建目录））
    if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
      throw new Error(`目标目录已存在且非空，创建已取消：${targetDir}——请换一个项目名称或目录`);
    }
    const project: Project = {
      id: randomUUID(),
      name: opts.name,
      path: resolvedPath,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      status: "setup",
      description: "",
    };

    fs.mkdirSync(targetDir, { recursive: true });
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
      // 清理 Pi 会话元数据（cache/pinned/archived/titles）→ session-types
      const { cleanupProjectSessions } = await import("./session-service");
      const sids = cleanupProjectSessions(project.path);
      if (sids.length > 0) {
        const { removeSessionTypes } = await import("./agent-service");
        removeSessionTypes(sids);
      }
      // Pi 会话目录 → 废纸篓。注意 getPiSessionDir 是经 SessionManager 向 SDK 取路径的，
      // 副作用是会把该目录 mkdir 出来——空目录（项目从未聊过/会话已清空）直接回收，不塞废纸篓。
      // 用不抛的 tryGet：启动期 SDK 预热未完成时取不到目录，此时**跳过会话目录处理**即可，
      // 不能让「删除项目」整条失败（项目记录照删，残留的会话目录留待下次启动清理）。
      const sessionDir = tryGetPiSessionDir(project.path);
      if (!sessionDir) {
        console.warn("[project] 会话目录未就绪（SDK 预热中），删除项目时跳过会话目录处理:", project.path);
      } else if (isEmptyDirShell(sessionDir)) {
        try {
          fs.rmdirSync(sessionDir);
        } catch { /* 被占用则保留空目录，无数据损失 */ }
      } else {
        await shell.trashItem(sessionDir);
      }
      // 旧 Claude SDK 遗留目录（v0.7.2 起不再产生，兜底清理）
      const sdkProjectsDir = path.join(os.homedir(), ".easymint", "projects");
      const encodedPath = project.path.replace(/[:/\\]/g, "-");
      const sdkDir = path.join(sdkProjectsDir, encodedPath);
      if (fs.existsSync(sdkDir)) await shell.trashItem(sdkDir);
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
      // Pi SDK 会话目录(agent/sessions/<路径编码>)——v0.7.2 起会话落盘于此
      // 用不抛的 tryGet（本函数是同步入口，不能 await 启动期的「SDK 预热 + 旧目录迁移」），
      // 搬迁本身交给 moveSessionDir —— 它内部处置「算路径即 mkdir」的副作用，调用方自己写
      // 「算两个路径 + 判 existsSync」会因新目录刚被 mkdir 而**整段跳过且不报错**（实测踩过）。
      // 注意这里**不吞** moveSessionDir 的 fs 错误：会话目录搬迁是路径变更的一部分，真搬不动
      // （权限/跨设备）就让这次变更整体失败、用户可重试——静默放过等于历史会话在新路径下消失。
      // （删项目不同：那里项目都要没了，跳过会话侧处理才是对的，故用 tryGet 兜底。）
      if (tryGetPiSessionDir(project.path) && tryGetPiSessionDir(patch.path)) {
        moveSessionDir(project.path, patch.path);
      } else {
        // 预热未完成：旧目录不会自己跟到新路径下（新目录名按新 cwd 编码）→ 挂到预热完成后补做，
        // 否则这次路径变更会让历史会话在新路径下**永久不可见**。
        deferSessionDirRename(project.path, patch.path);
      }
      // 旧 Claude SDK 遗留目录(v0.7.2 起不再产生,兜底清理)
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

  /** 创建目标预检（Step1 即时预警用）：目录已存在且非空 = 冲突（创建会被拒，见 create） */
  checkTargetDir(basePath: string, name: string): { conflict: boolean } {
    if (/[\\/]/.test(name)) return { conflict: true }; // 名称含路径分隔符，create 必拒
    const targetDir = path.resolve(resolveHome(basePath), name);
    return { conflict: fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 };
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

      // Pi SDK 会话目录(v0.7.2 起会话落盘 ~/.easymint/agent/sessions/<路径编码>)
      // ——必须一并复制，否则重命名后历史会话在新路径下不可见。
      // 这里用「复制」而非搬迁：旧目录留给下面的清理任务删（源目录此时还在用）。
      // ⚠️ 目标目录会被 getPiSessionDir 顺手 mkdir 出来 → 必须先清空壳再复制，
      //    直接判 `!existsSync(新目录)` 恒为假、**根本不会复制**（实测踩过）。
      // 这是 async 流程，先 await 就绪门再取目录（拿到确定结果）；取不到只跳过这一段，
      // **不把整条重命名流程判失败**（目录已复制完成，会话目录问题不该回滚用户的重命名）。
      let oldPiSessDir: string | undefined;
      try {
        await ensureSessionManagerClass();
        oldPiSessDir = getPiSessionDir(oldDir);
        const newPiSessDir = getPiSessionDir(newDir);
        if (fs.existsSync(oldPiSessDir) && fs.readdirSync(oldPiSessDir).length > 0) {
          if (isEmptyDirShell(newPiSessDir)) fs.rmdirSync(newPiSessDir);
          await cp(oldPiSessDir, newPiSessDir, { recursive: true });
        }
      } catch (e) {
        console.warn("[project] 重命名项目时会话目录未迁移（历史会话可能需重新指定路径）:", (e as Error).message);
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
      const cleanTask = { oldDir, oldSessionDir: oldSessDir, oldPiSessionDir: oldPiSessDir, timestamp: Date.now() };
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
