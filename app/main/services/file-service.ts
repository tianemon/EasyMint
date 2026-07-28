import fs from "fs";
import path from "path";
import { resolveHome } from "../utils/paths";

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

  /** 检查路径是否包含穿越攻击（.. 等） */
  private isPathSafe(filePath: string, baseDir?: string): boolean {
    const expanded = this.expand(filePath);
    const resolved = path.resolve(baseDir ?? expanded, expanded);
    const normalized = path.normalize(resolved);
    // 拒绝包含 ../ 的路径（穿越攻击标志）
    if (normalized.includes("..")) return false;
    if (baseDir) {
      const rel = path.relative(path.resolve(baseDir), normalized);
      if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
    }
    return true;
  }

  readTree(dirPath: string, maxDepth = 10): FileNode[] {
    const expanded = this.expand(dirPath);
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
            children: this.readTree(fullPath, maxDepth - 1),
          };
        }
        return { name: entry.name, path: fullPath, isDirectory: false };
      });
  }

  readContent(filePath: string): string {
    if (!filePath) return "";
    if (!this.isPathSafe(filePath)) return "";
    const expanded = this.expand(filePath);
    if (!fs.existsSync(expanded)) return "";
    return fs.readFileSync(expanded, "utf-8");
  }

  writeContent(filePath: string, content: string): void {
    if (!filePath || !this.isPathSafe(filePath)) {
      throw new Error("无效的文件路径");
    }
    const expanded = this.expand(filePath);
    fs.mkdirSync(path.dirname(expanded), { recursive: true });
    fs.writeFileSync(expanded, content, "utf-8");
  }
}
