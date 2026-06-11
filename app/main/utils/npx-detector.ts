import { execSync } from "child_process";

export interface DetectResult {
  found: boolean;
  version?: string;
}

export function detectNpx(): DetectResult {
  try {
    const version = execSync("npx --version", { encoding: "utf-8", timeout: 10000 }).trim();
    return { found: true, version: `npm ${version}` };
  } catch {
    return { found: false };
  }
}
