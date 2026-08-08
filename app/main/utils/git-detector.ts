import { spawnSync } from "child_process";

export interface DetectResult {
  found: boolean;
  version?: string;
}

export function detectGit(): DetectResult {
  try {
    // spawnSync 不走 cmd shell——win 上找不到命令时 cmd 输出 GBK 报错会透传控制台成乱码
    const r = spawnSync("git", ["--version"], { encoding: "utf-8", timeout: 5000, stdio: "pipe", windowsHide: true });
    if (r.status !== 0 || !r.stdout) return { found: false };
    const version = r.stdout.trim();
    // Output is like "git version 2.39.3 (Apple Git-145)"
    const match = version.match(/git version (\S+)/);
    return { found: true, version: match?.[1] || version };
  } catch {
    return { found: false };
  }
}
