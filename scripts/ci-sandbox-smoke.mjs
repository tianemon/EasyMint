/**
 * srt 沙盒跨平台冒烟（CI 用：.github/workflows/sandbox-smoke.yml）
 * 断言：initialize 成功 → wrap 命令 → 执行成功 exit 0。
 * 平台差异（Linux 需 bwrap/socat/rg 已装；Windows 需已跑 windows-install）由 workflow 前置步骤保证。
 */
import { SandboxManager, VENDORED_SRT_WIN_EXE } from "@anthropic-ai/sandbox-runtime";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const log = (s) => process.stdout.write(s + "\n");
log(`[smoke] platform=${process.platform} node=${process.version}`);

const config = {
  network: { allowedDomains: ["*"], deniedDomains: [] },
  filesystem: {
    denyRead: [path.join(homedir(), ".ssh")],
    allowWrite: [process.cwd()],
    denyWrite: [],
  },
  // Windows：srt 要求显式指定 srt-win.exe（vendor 随包）路径
  ...(process.platform === "win32" ? { windows: { srtWin: { path: VENDORED_SRT_WIN_EXE } } } : {}),
};
await SandboxManager.initialize(config);
log("[smoke] initialize OK");

// Windows：srt 不支持 shell 字符串包装，必须用 argv 形态（srt-win 两跳）+ shell:false；
// Unix：shell 字符串包装（wrapWithSandbox）。
const isWin = process.platform === "win32";
const wrapped = isWin
  ? await SandboxManager.wrapWithSandboxArgv("echo SMOKE-OK")
  : await SandboxManager.wrapWithSandbox("echo SMOKE-OK");
const r = isWin
  ? spawnSync(wrapped.argv[0], wrapped.argv.slice(1), { cwd: process.cwd(), encoding: "utf8", timeout: 60000, env: { ...process.env, ...wrapped.env } })
  : spawnSync(wrapped, { shell: true, cwd: process.cwd(), encoding: "utf8", timeout: 60000 });
if (r.status !== 0) {
  console.error("[smoke] 执行失败:", { status: r.status, stdout: r.stdout, stderr: r.stderr, wrapped: isWin ? wrapped.argv : String(wrapped).slice(0, 200) });
  process.exit(1);
}
if (!r.stdout.includes("SMOKE-OK")) {
  console.error("[smoke] 输出不符合预期:", r.stdout);
  process.exit(1);
}
log(`[smoke] 执行 OK: ${r.stdout.trim()}`);
await SandboxManager.reset();
log("[smoke] 全部通过");
