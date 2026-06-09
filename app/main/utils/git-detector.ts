import { execSync } from "child_process";

export interface DetectResult {
  found: boolean;
  version?: string;
}

export function detectGit(): DetectResult {
  try {
    const version = execSync("git --version", { encoding: "utf-8", timeout: 5000 }).trim();
    // Output is like "git version 2.39.3 (Apple Git-145)"
    const match = version.match(/git version (\S+)/);
    return { found: true, version: match?.[1] || version };
  } catch {
    return { found: false };
  }
}
