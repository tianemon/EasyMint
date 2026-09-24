import fs from "fs";
import path from "path";
import { resolveHome } from "../utils/paths";
import type { FileReadResult } from "../../shared/file-read";
import { canonicalPolicyPath, isWithin, pathHitsAny, protectedCredentialPaths, protectedWriteRoots } from "./permission/access-policy";

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
   * 展开 home、折叠 `..` 并解析已存在祖先的真实路径，再校验系统核心/凭据保护及
   * baseDir 包含关系。工作区内合法的 `a/../b` 不误拒，真正越界仍会被识别。
   */
  isPathSafe(filePath: string, baseDir?: string): boolean {
    if (!filePath) return false;
    if (!baseDir) return false;
    const base = canonicalPolicyPath(this.expand(baseDir), process.cwd());
    const target = canonicalPolicyPath(this.expand(filePath), base);
    if (pathHitsAny(target, [...protectedWriteRoots(), ...protectedCredentialPaths()], base)) return false;
    return isWithin(base, target);
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

  /**
   * 读取文本文件内容（file:readContent 通道）。
   *
   * 失败不再返回空串，而是带上原因码：调用方据此给用户一句准确提示——原先「越界」与
   * 「文件不存在」都返回 ""，渲染层无法与空文件区分，表现为空白 tab 且无任何提示。
   * 存在性判定在归属判定之前：链接指向一个已改名/删除的文件时，先说「不在项目内」会掩盖真正的原因。
   * 这会区分越界路径的存在性；本结果只返回本机 UI。若接入模型或远程命令，须先校验归属。
   * baseDir 可为 null（路径不属于任何已登记项目根时，由调用方传入）。
   */
  readContent(baseDir: string | null, filePath: string): FileReadResult {
    if (!filePath) return { ok: false, reason: "missing" };
    const expanded = this.expand(filePath);
    // throwIfNoEntry：不存在时返回 undefined，不在 existsSync 与 statSync 之间留竞态窗口
    const stat = fs.statSync(expanded, { throwIfNoEntry: false });
    if (!stat?.isFile()) return { ok: false, reason: "missing" };
    if (!this.isPathSafe(filePath, baseDir ?? undefined)) return { ok: false, reason: "outside-project" };
    return { ok: true, content: fs.readFileSync(expanded, "utf-8") };
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
