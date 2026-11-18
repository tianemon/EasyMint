import { randomUUID,randomBytes,createHash } from "crypto";
import fs from "fs";
import path from "path";
import { shell } from "electron";
import { Store } from "./store";
import {initializeProjectRules,discoverProjectRules,initialProjectRuleOwnership,applyInitialProjectProfile,assertInitialProjectRules,finishInitialProjectProfile,initialProjectProfileContent,restoreInitialProjectRules,type ProjectRuleOwnership} from "./project-rule-files";
import {lockConfigDirectory} from "./native-config-storage";
import {listOpenProjectIds} from "./window-manager";
import { relocateProjectSessions } from "./project-session-relocation";
import { withSessionCreationLock } from "./session-permission-gate";
import { t } from "./ui-language";
import { resolveHome, emHome } from "../utils/paths";
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
  /** 新空项目创建时的自动记录选择；导入已有目录不自动接管旧记录。 */
  autoMemoryRecords?: boolean;
  creationRules?:ProjectRuleOwnership;
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

function hasProjectDirectory(directory: string): boolean {
  try { return fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true; }
  catch { return false; }
}

/** The renderer can identify its creation request, but only the host seals the
 * ownership proof after the actual new session is ready. */
export function creationSessionReady(service:Pick<ProjectService,"finishCreation">,projectPath:string,resumeSessionId:string|null|undefined,payload?:{details?:Record<string,unknown>}):(()=>void)|undefined {
  if(!["project-created","direct-create"].includes(String(payload?.details?.kind)))return;
  if(resumeSessionId)throw new Error("创建首条消息不能重发到已有会话，请沿原会话继续");
  const id=payload?.details?.creationProjectId,revision=payload?.details?.creationRevision;
  if(typeof id!=="string"||!id||typeof revision!=="string"||!/^[a-f0-9]{64}$/u.test(revision))throw new Error("新建配置凭据缺失，请重新打开创建流程核对；未发送首条消息");
  return ()=>service.finishCreation(projectPath,id,revision);
}

export function finishCreationOwnership(store:Store,projectPath:string,projectId:string,expectedRevision:string):void {
  if(!store.getProjects().some(project=>project.id===projectId&&path.resolve(project.path)===path.resolve(projectPath)&&project.creationRules?.revision===expectedRevision&&!project.creationRules.preparedHash))throw new Error("新建项目配置已变化，请重新确认后再启动");
  const metadata=fs.lstatSync(path.join(path.resolve(projectPath),".easymint"),{throwIfNoEntry:false});if(metadata&&(!metadata.isDirectory()||metadata.isSymbolicLink()))throw new Error("新建配置目录已被替换，未启动会话");
  const release=lockCreationOwnership(store,projectPath);
  try{
    const projects=store.getProjects(),project=projects.find(item=>item.id===projectId&&path.resolve(item.path)===path.resolve(projectPath));
    if(!project?.creationRules||project.creationRules.revision!==expectedRevision||project.creationRules.preparedHash)throw new Error("新建项目配置已变化，请重新确认后再启动");
    assertInitialProjectRules(project.path,project.creationRules);delete project.creationRules;store.saveProjects(projects);finishInitialProjectProfile(project.path);
  }finally{release();}
}

/** Serializes ownership changes across windows while keeping ordinary takeover off the project filesystem. */
function lockCreationOwnership(store: Store, projectPath?: string): () => void {
  const releaseRegistry = lockConfigDirectory(path.join(store.getDataDir(), ".control-tmp", "project-creation"));
  if (!projectPath) return releaseRegistry;
  try {
    const releaseProject = lockConfigDirectory(path.join(path.resolve(projectPath), ".easymint"));
    return () => { try { releaseProject(); } finally { releaseRegistry(); } };
  } catch (error) { releaseRegistry(); throw error; }
}

/** Ordinary chat takes over the project without claiming or rewriting its rules. */
export function releaseCreationOwnership(store:Store,projectPath:string):void {
  const initial=store.getProjects().find(project=>path.resolve(project.path)===path.resolve(projectPath));if(!initial?.creationRules)return;
  const release=lockCreationOwnership(store);
  try{
    const projects=store.getProjects(),project=projects.find(item=>item.id===initial.id&&path.resolve(item.path)===path.resolve(projectPath));if(!project?.creationRules)return;
    if (project.creationRules.preparedHash) throw new Error("上次新建项目的配置保存未完成，请在新建项目中填写原项目名称和目录后重试");
    delete project.creationRules;store.saveProjects(projects);finishInitialProjectProfile(project.path);
  }finally{release();}
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
        exists: hasProjectDirectory(p.path),
      }))
      // 最近打开在前（打开项目弹窗的默认顺序）。排序放这里，UI 与其它调用方共用同一顺序。
      // sort 稳定(ES2019+)：lastOpenedAt 相同的按 projects.json 原有顺序，不会来回抖
      .sort((a, b) => openedAt(b) - openedAt(a));
  }

  create(opts: { name: string; path: string; directoryName?: string }): Project {
    const projects = this.store.getProjects();
    const basePath = resolveHome(opts.path);
    const directoryName = opts.directoryName ?? opts.name;
    // 名称含路径分隔符会解析成嵌套目录（用户可能从翻译/粘贴带入）——先拒绝再解析
    if (!directoryName.trim() || directoryName === "." || directoryName === ".." || /[\\/]/.test(directoryName)) {
      throw new Error(`项目文件夹名称无效：${directoryName}`);
    }
    const resolvedPath = path.resolve(basePath, directoryName);
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
      autoMemoryRecords: this.store.getSettings().memory?.enabled === true,
    };

    fs.mkdirSync(targetDir, { recursive: true });
    this.copyTemplate(targetDir);
    project.creationRules=initialProjectRuleOwnership(targetDir);

    projects.push(project);
    this.store.saveProjects(projects);
    return project;
  }

  /** Keep profile assets and the generated rule suffix under one project lock.
   * The registry's ownership proof survives an app restart and is never inferred. */
  saveCreationProfile(projectPath:string,specification:string,saveProfile:()=>void|(()=>void)):{creationRulesHash:string;creationRevision:string} {
    if(!this.store.getProjects().some(project=>path.resolve(project.path)===path.resolve(projectPath)&&project.creationRules))throw new Error("新建规则所有权不可验证或首次会话已启动，未自动覆盖项目规则；请在项目中明确核对配置");
    const metadata=fs.lstatSync(path.join(path.resolve(projectPath),".easymint"),{throwIfNoEntry:false});if(metadata&&(!metadata.isDirectory()||metadata.isSymbolicLink()))throw new Error("新建配置目录已被替换，已保留原件；未应用新配置");
    const release=lockCreationOwnership(this.store,projectPath);
    try{
      const projects=this.store.getProjects(),project=projects.find(item=>path.resolve(item.path)===path.resolve(projectPath));
      if(!project?.creationRules)throw new Error("新建规则所有权不可验证或首次会话已启动，未自动覆盖项目规则；请在项目中明确核对配置");
      let proof={hash:project.creationRules.hash,baseBytes:project.creationRules.baseBytes},before:Buffer;
      try{before=assertInitialProjectRules(project.path,proof);}
      catch(error){if(!project.creationRules.preparedHash)throw error;proof={...proof,hash:project.creationRules.preparedHash};before=assertInitialProjectRules(project.path,proof);}
      const nextHash=createHash("sha256").update(initialProjectProfileContent(before,proof.baseBytes,specification)).digest("hex"),revision=randomBytes(32).toString("hex");
      // Revoke old receipts before touching any profile/design asset. The planned
      // hash lets a retry recognize our own rule replacement after interruption.
      project.creationRules={...proof,preparedHash:nextHash};this.store.saveProjects(projects);
      let rollbackAssets: void | (() => void) = undefined;
      try{
        rollbackAssets = saveProfile();
        const current=this.store.getProjects(),target=current.find(item=>item.id===project.id);
        if(!target?.creationRules||target.creationRules.hash!==proof.hash||target.creationRules.preparedHash!==nextHash||target.creationRules.revision!==undefined)throw new Error("新建项目状态已变化，请重新读取后再试");
        const owned=applyInitialProjectProfile(project.path,specification,proof)!;
        target.creationRules={...owned,revision};this.store.saveProjects(current);return {creationRulesHash:owned.hash,creationRevision:revision};
      }catch(error){
        const projectsAfterFailure=this.store.getProjects();
        const target=projectsAfterFailure.find(item=>item.id===project.id);
        const current=target?.creationRules;
        // A durable commit with a lost acknowledgement is already successful.
        if(current?.revision===revision&&!current.preparedHash&&current.hash===nextHash){assertInitialProjectRules(project.path,current);return {creationRulesHash:nextHash,creationRevision:revision};}
        let rollbackError: unknown;
        try { rollbackAssets?.(); } catch (cause) { rollbackError = cause; }
        if (target && current?.revision === undefined && current?.hash === proof.hash && current.preparedHash === nextHash) {
          try {
            try { assertInitialProjectRules(project.path, proof); }
            catch { restoreInitialProjectRules(project.path, { ...proof, hash: nextHash }, before); }
          } catch {
            throw new Error(`新建配置保存失败，项目规则已变化并已保留：${(error as Error).message}`, { cause: error });
          }
          if (rollbackAssets && !rollbackError) {
            // Only release the fence after both assets and rules were restored.
            target.creationRules = proof;
            this.store.saveProjects(projectsAfterFailure);
          }
        }
        if (rollbackError) throw new Error(`新建配置保存失败，视觉配置恢复未完成：${(rollbackError as Error).message}`, { cause: error });
        throw error;
      }
    }finally{release();}
  }

  finishCreation(projectPath:string,projectId:string,expectedRevision:string):void {
    finishCreationOwnership(this.store,projectPath,projectId,expectedRevision);
  }

  async delete(id: string): Promise<void> {
    // Hidden tray windows remain live workspaces. Enforce the UI contract here
    // too, since another window can open a project after the list was rendered.
    if(listOpenProjectIds().includes(id))throw new Error("This project is open in a window. Leave the project before deleting it.");
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
      const sdkProjectsDir = path.join(emHome(), "projects");
      const encodedPath = project.path.replace(/[:/\\]/g, "-");
      const sdkDir = path.join(sdkProjectsDir, encodedPath);
      if (fs.existsSync(sdkDir)) await shell.trashItem(sdkDir);
    }
    const projects = this.store.getProjects().filter((p) => p.id !== id);
    this.store.saveProjects(projects);
  }

  get(id: string): (Project & { exists: boolean; canResumeCreation: boolean }) | undefined {
    const p = this.store.getProjects().find((p) => p.id === id);
    if (!p) return undefined;
    return { ...p, exists: hasProjectDirectory(p.path), canResumeCreation: Boolean(p.creationRules) };
  }

  async relocate(id: string, expectedPath: string, directory: string, assertIdle: (oldPath: string, newPath: string) => void) {
    const readTarget = () => {
      try {
        const path = fs.realpathSync(directory);
        const stat = fs.statSync(path);
        if (stat.isDirectory()) {
          fs.accessSync(path, fs.constants.R_OK | fs.constants.X_OK);
          return { path, stat };
        }
      } catch { /* report the selected directory as unavailable */ }
      throw new Error(t("messages.projectRelocationInvalidDirectory"));
    };
    const initial = readTarget();
    const target = initial.path;
    const check = (): void => {
      const projects = this.store.getProjects();
      const project = projects.find(item => item.id === id);
      if (project?.path !== expectedPath || hasProjectDirectory(expectedPath)) {
        throw new Error(t("messages.projectRelocationChanged"));
      }
      const selected = readTarget();
      if (selected.path !== target || selected.stat.dev !== initial.stat.dev || selected.stat.ino !== initial.stat.ino) {
        throw new Error(t("messages.projectRelocationInvalidDirectory"));
      }
      const occupied = (candidate: string) => {
        if (path.relative(candidate, target) === "") return true;
        try { return path.relative(fs.realpathSync(candidate), target) === ""; }
        catch { return false; }
      };
      const workspace = path.resolve(resolveHome(this.store.getSettings().defaultProjectDir || "~/EasyMintProject"), "workspace");
      if (occupied(workspace) || projects.some(item => item.id !== id && occupied(item.path))) {
        throw new Error(t("messages.projectRelocationOccupied"));
      }
      assertIdle(expectedPath, target);
    };

    await ensureSessionManagerClass();
    return withSessionCreationLock(async () => {
      check();
      return relocateProjectSessions(id, expectedPath, target, () => {
        check();
        const updated = this.store.updateProject(id, { path: target });
        if (!updated) throw new Error(t("messages.projectRelocationChanged"));
        return { ...updated, exists: true };
      });
    });
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
      const sdkDir = path.join(emHome(), "projects");
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

  /** Check directory conflicts and locate an interrupted creation even without a renderer draft. */
  checkTargetDir(basePath: string, name: string, projectName?: string): {
    conflict: boolean;
    resumeProject?: { id: string; path: string; directoryName: string };
  } {
    if (/[\\/]/.test(name)) return { conflict: true }; // 名称含路径分隔符，create 必拒
    const base = path.resolve(resolveHome(basePath));
    const targetDir = path.resolve(base, name);
    if (projectName) {
      const matching = this.store.getProjects().filter(project => project.name === projectName &&
        path.relative(base, path.dirname(project.path)) === "" && fs.existsSync(project.path));
      const pending = matching.find(project => project.status === "setup" && project.creationRules?.preparedHash);
      // A provisional translation cannot select among same-name projects or override an occupied path.
      if (pending && matching.length > 1) return { conflict: true };
      if (pending && (path.relative(targetDir, pending.path) === "" || !fs.existsSync(targetDir))) return {
        conflict: true,
        resumeProject: { id: pending.id, path: pending.path, directoryName: path.basename(pending.path) },
      };
    }
    return { conflict: fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 };
  }

  /** 导入已有目录为项目（不复制 template，目录已存在） */
  import_(dirPath: string): (Project & { exists: boolean; isNew: boolean; warning?:string }) {
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
    let warning:string|undefined;
    try{const existing=discoverProjectRules(resolved);if(!existing.hasExisting)warning=initializeProjectRules(resolved,fs.readFileSync(path.join(this.templateDir,"AGENTS.md"),"utf8"),project.name);else warning=existing.warnings.join("\n") || undefined;}
    catch(error){warning=`项目已登记，默认规则未创建：${(error as Error).message}`;}
    if(warning)console.warn(warning);
    return { ...project, exists: true, isNew: true,...(warning?{warning}:{}) };
  }

  /** 重命名项目：复制→更新记录→写清理任务。由调用方负责 app.relaunch/quit */
  async rename(oldDir: string, newName: string): Promise<{ ok: boolean; error?: string }> {
    const parentDir = path.dirname(oldDir);
    const newDir = path.join(parentDir, newName);

    if (path.basename(oldDir) === newName) return { ok: false, error: "新名称与当前名称相同" };
    if (fs.existsSync(newDir)) return { ok: false, error: `目标目录已存在: ${newDir}` };
    if (!fs.existsSync(oldDir)) return { ok: false, error: `项目目录不存在: ${oldDir}` };

    const newSessDir = path.join(emHome(), "projects",
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
      const oldSessDir = path.join(emHome(), "projects",
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
      const projectsPath = path.join(emHome(), "projects.json");
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
      const cleanFile = path.join(emHome(), ".cleanup-pending.json");
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
      if (entry === "AGENTS.md") {
        const warning=initializeProjectRules(targetDir,fs.readFileSync(src,"utf8"),path.basename(targetDir),false);if(warning)console.warn(warning);
      } else if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }
    fs.mkdirSync(path.join(targetDir, "temp"), { recursive: true });
  }
}
