import { execSync } from "child_process";

export interface DetectResult {
  found: boolean;
  version?: string;
}

export function detectNode(): DetectResult {
  try {
    const version = execSync("node --version", { encoding: "utf-8", timeout: 5000 }).trim();
    return { found: true, version };
  } catch {
    return { found: false };
  }
}
