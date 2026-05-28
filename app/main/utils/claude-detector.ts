import { execSync } from "child_process";
import fs from "fs";
import path from "path";

export interface DetectResult {
  found: boolean;
  path?: string;
  version?: string;
}

export function detectClaude(envPath?: string): DetectResult {
  const pathDirs = (envPath ?? process.env.PATH ?? "").split(path.delimiter);

  for (const dir of pathDirs) {
    if (!dir) continue;
    const claudePath = path.join(dir, "claude");
    try {
      fs.accessSync(claudePath, fs.constants.X_OK);
      const version = execSync(`"${claudePath}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
      return { found: true, path: claudePath, version };
    } catch {
      // Not found or not executable in this dir, continue
    }
  }

  return { found: false };
}
