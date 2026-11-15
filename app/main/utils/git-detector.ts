import { spawnSync } from "child_process";
import { preparedWindowsRuntime, windowsRuntimeEnvironment } from "../services/windows-runtime";

export interface DetectResult {
  found: boolean;
  version?: string;
}

export function detectGit(): DetectResult {
  // spawnSync 不走 cmd shell——win 上找不到命令时 cmd 输出 GBK 报错会透传控制台成乱码
  const runtime = process.platform === "win32" ? preparedWindowsRuntime() : undefined;
  const command = runtime?.git ?? "git";
  try {
    const r = spawnSync(command, ["--version"], { env: runtime ? windowsRuntimeEnvironment(process.env, runtime) : undefined, encoding: "utf-8", timeout: 5000, stdio: "pipe", windowsHide: true });
    if (r.status !== 0 || !r.stdout) {
      // 留痕：静默会把「没装」和「装了但 PATH 里找不到 / 启不来」压成同一结论，
      // 面板只会显示"未安装"，用户于是反复重装（2026-11-15：系统 git 明明在 PATH 里）。
      const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
      console.warn(`[git-detector] 探测失败 cmd=${command} reason=${code ?? `exit ${r.status}`}`);
      return { found: false };
    }
    const version = r.stdout.trim();
    // Output is like "git version 2.39.3 (Apple Git-145)"
    const match = version.match(/git version (\S+)/);
    return { found: true, version: match?.[1] || version };
  } catch (e) {
    console.warn(`[git-detector] spawn 异常 cmd=${command}`, e);
    return { found: false };
  }
}
