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

  readTree(dirPath: string): FileNode[] {
    const expanded = this.expand(dirPath);
    if (!fs.existsSync(expanded)) return [];
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
            children: this.readTree(fullPath),
          };
        }
        return { name: entry.name, path: fullPath, isDirectory: false };
      });
  }

  readContent(filePath: string): string {
    if (!filePath) return "";
    const expanded = this.expand(filePath);
    if (!fs.existsSync(expanded)) return "";
    return fs.readFileSync(expanded, "utf-8");
  }

  writeContent(filePath: string, content: string): void {
    const expanded = this.expand(filePath);
    fs.mkdirSync(path.dirname(expanded), { recursive: true });
    fs.writeFileSync(expanded, content, "utf-8");
  }
}
