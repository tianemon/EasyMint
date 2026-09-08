import fs from "fs";
import path from "path";
import { resolveHome } from "../utils/paths";
import { isSystemForbidden, isSecretForbidden } from "./permission/permission-rules";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

export class FileService {
  private expand(p: string): string {
    return resolveHome(p);
  }

  /**
   * 路径安全校验（强制 baseDir 包含关系——file:* 通道防任意路径读写）。
   *
   * ① 原始字符串先查 `..` 段（path.normalize 会把 `..` 提前消掉，检查必须跑在 normalize 之前，
   *    否则 `~/Documents/../.ssh/id_rsa` 归一化后变成明文合法路径直接放行）；
   * ② 展开 ~ 后的绝对路径命中系统核心/凭据禁区 → 绝对拒绝（即使 baseDir 覆盖也不放行）；
   * ③ resolve 后必须等于 baseDir 或落在 baseDir 之内（startsWith(baseDir + sep)）。
   */
  isPathSafe(filePath: string, baseDir?: string): boolean {
    if (!filePath) return false;
    if (rawHasDotDotSegments(filePath)) return false;
    const expanded = this.expand(filePath);
    const resolved = path.resolve(expanded);
    const normalized = path.normalize(resolved);
    // 系统核心 / 凭据目录是绝对禁区（可豁免 baseDir 内豁免逻辑）
    if (isSystemForbidden(normalized) || isSecretForbidden(normalized)) return false;
    if (!baseDir) return false;
    const base = path.resolve(this.expand(baseDir));
    return normalized === base || normalized.startsWith(base + path.sep);
  }

  readTree(baseDir: string, dirPath: string, maxDepth = 10): FileNode[] {
    const expanded = this.expand(dirPath);
    if (!this.isPathSafe(dirPath, baseDir)) return [];
    if (!fs.existsSync(expanded)) return [];
    if (maxDepth <= 0) return [];
    const entries = fs.readdirSync(expanded, { withFileTypes: true });
    const exclude = new Set([".git", "node_modules", ".DS_Store", "dist", "temp"]);
    return entries
      .filter((e) => !exclude.has(e.name))
      .map((entry): FileNode => {
        const fullPath = path.join(expanded, entry.name);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: true,
            children: this.readTree(baseDir, fullPath, maxDepth - 1),
          };
        }
        return { name: entry.name, path: fullPath, isDirectory: false };
      });
  }

  readContent(baseDir: string, filePath: string): string {
    if (!filePath || !this.isPathSafe(filePath, baseDir)) return "";
    const expanded = this.expand(filePath);
    if (!fs.existsSync(expanded)) return "";
    return fs.readFileSync(expanded, "utf-8");
  }

  writeContent(baseDir: string, filePath: string, content: string): void {
    if (!filePath || !this.isPathSafe(filePath, baseDir)) {
      throw new Error("无效的文件路径");
    }
    const expanded = this.expand(filePath);
    fs.mkdirSync(path.dirname(expanded), { recursive: true });
    fs.writeFileSync(expanded, content, "utf-8");
  }

  /** 新建文件（已存在时抛错，不覆盖） */
  createFile(baseDir: string, filePath: string, content = ""): void {
    if (!filePath || !this.isPathSafe(filePath, baseDir)) {
      throw new Error("无效的文件路径");
    }
    const expanded = this.expand(filePath);
    if (fs.existsSync(expanded)) {
      throw new Error("文件已存在");
    }
    fs.mkdirSync(path.dirname(expanded), { recursive: true });
    fs.writeFileSync(expanded, content, "utf-8");
  }

  /** 新建文件夹（已存在时抛错，不覆盖） */
  createFolder(baseDir: string, dirPath: string): void {
    if (!dirPath || !this.isPathSafe(dirPath, baseDir)) {
      throw new Error("无效的目录路径");
    }
    const expanded = this.expand(dirPath);
    if (fs.existsSync(expanded)) {
      throw new Error("文件夹已存在");
    }
    fs.mkdirSync(expanded, { recursive: true });
  }
}

/** 原始路径是否含 `..` 路径段（穿越攻击标志；双反斜杠/正斜杠统一按分隔符拆分检查） */
function rawHasDotDotSegments(p: string): boolean {
  const segs = p.split(/[\\/]+/);
  return segs.includes("..");
}
