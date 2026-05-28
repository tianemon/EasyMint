import { execSync } from "child_process";
import fs from "fs";

interface DetectResult {
  found: boolean;
  path?: string;
  version?: string;
}

export function detectClaude(): DetectResult {
  const pathDirs = (process.env.PATH || "").split(":");

  for (const dir of pathDirs) {
    const claudePath = `${dir}/claude`;
    try {
      if (fs.existsSync(claudePath)) {
        const version = execSync(`"${claudePath}" --version`, { encoding: "utf-8", timeout: 5000 }).trim();
        return { found: true, path: claudePath, version };
      }
    } catch {
      // Not found in this dir, continue
    }
  }

  return { found: false };
}
