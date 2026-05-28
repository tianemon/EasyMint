import fs from "fs";
import path from "path";

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

export class FileService {
  readTree(dirPath: string): FileNode[] {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const exclude = new Set([".git", "node_modules", ".DS_Store", "dist", "temp"]);
    return entries
      .filter((e) => !exclude.has(e.name))
      .map((entry): FileNode => {
        const fullPath = path.join(dirPath, entry.name);
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
    return fs.readFileSync(filePath, "utf-8");
  }

  writeContent(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, "utf-8");
  }
}
