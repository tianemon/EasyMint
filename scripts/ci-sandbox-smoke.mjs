/**
 * srt 沙盒跨平台冒烟（CI 用：.github/workflows/sandbox-smoke.yml）
 * 断言：initialize 成功 → wrap 命令 → 执行成功 exit 0。
 * 平台差异（Linux 需 bwrap/socat/rg 已装；Windows 需已跑 windows-install）由 workflow 前置步骤保证。
 */
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const log = (s) => process.stdout.write(s + "\n");
log(`[smoke] platform=${process.platform} node=${process.version}`);

await SandboxManager.initialize({
  network: { allowedDomains: ["*"], deniedDomains: [] },
  filesystem: {
    denyRead: [path.join(homedir(), ".ssh")],
    allowWrite: [process.cwd()],
    denyWrite: [],
  },
});
log("[smoke] initialize OK");

const wrapped = await SandboxManager.wrapWithSandbox("echo SMOKE-OK");
const r = spawnSync(wrapped, { shell: true, cwd: process.cwd(), encoding: "utf8", timeout: 60000 });
if (r.status !== 0) {
  console.error("[smoke] 执行失败:", { status: r.status, stdout: r.stdout, stderr: r.stderr, wrapped: String(wrapped).slice(0, 200) });
  process.exit(1);
}
if (!r.stdout.includes("SMOKE-OK")) {
  console.error("[smoke] 输出不符合预期:", r.stdout);
  process.exit(1);
}
log(`[smoke] 执行 OK: ${r.stdout.trim()}`);
await SandboxManager.reset();
log("[smoke] 全部通过");
