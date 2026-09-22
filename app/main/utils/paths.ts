/**
 * main 进程共享工具
 */
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

/** 解析 ~ 开头的路径为绝对路径，非 ~ 原样返回 */
export function resolveHome(dir: string): string {
  if (!dir.startsWith("~")) return dir;
  return path.join(os.homedir(), dir.slice(1));
}

/**
 * EM 全局数据目录（默认 `~/.easymint`）。
 *
 * `EASYMINT_HOME` 可覆盖它。用途：开发版与安装版默认共用同一份配置，跨版本混开时旧版本
 * 读不到新结构的字段（见 `em-settings-schema` 的结构迁移）；把开发版指到独立目录即可互不干扰，
 * `npm run dev:isolated` 就是这个用法。
 *
 * ⚠️ **只影响全局目录**——项目级的 `<项目>/.easymint/` 跟项目走，不受此变量影响。
 * ⚠️ 在**模块加载时**求值（多处是模块级常量），所以必须在启动进程**之前**设置该变量：
 * 代码里再赋值已经晚了——要写在 `package.json` 的 script 或命令行前置 env 里。
 */
export function emHome(): string {
  const override = process.env.EASYMINT_HOME?.trim();
  return override ? resolveHome(override) : path.join(os.homedir(), ".easymint");
}

/**
 * 返回 dir 自身、或其最近的、真实存在的祖先目录；都不存在（或 dir 为空）时返回 undefined。
 *
 * 用于 dialog.defaultPath：Electron 要求传**绝对路径**且不解析 `~`；提示性路径（如项目目录）
 * 在用户尚未创建过项目时并不存在，而官方文档未定义「defaultPath 指向不存在的目录」时各平台的兜底行为
 * （不给 defaultPath 时的兜底反而是 Downloads → home，与期望不符）。先上溯到真实存在的目录，
 * 行为在各平台一致。跨平台：path.dirname 到根（POSIX `/`、Windows `C:\`）时 parent === cur，循环终止。
 */
export function nearestExistingDir(dir: string | undefined): string | undefined {
  let cur = dir;
  while (cur) {
    try {
      if (fs.statSync(cur).isDirectory()) return cur;
    } catch { /* 不存在 / 无权限 / 断链符号链接 → 继续上溯 */ }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/** 资源目录:dev = 项目根 resources/;打包 = process.resourcesPath(extraResources 输出,asar 外)。
    打包后 __dirname 在 asar 内,../ 到不了 asar 外——必须走 process.resourcesPath */
export function getResourcesDir(): string {
  return app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, "..", "..", "..", "resources");
}

// ── 常量 ──────────────────────────────────────────────

/** 图片扩展名 → MIME 类型（须覆盖 shared/image-files.ts 的全部图片扩展名，
    否则会被兜底成 image/png 发出错误 MIME） */
export const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
  ".avif": "image/avif", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
