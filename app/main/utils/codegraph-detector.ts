import { execSync } from "child_process";

export interface DetectResult {
  found: boolean;
  version?: string;
}

export function detectCodegraph(): DetectResult {
  try {
    const version = execSync("codegraph --version", { encoding: "utf-8", timeout: 5000 }).trim();
    return { found: true, version };
  } catch {
    return { found: false };
  }
}
