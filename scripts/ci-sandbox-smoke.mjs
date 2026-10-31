/** Real-kernel smoke: positive execution and denial assertions, or expected namespace rejection.
 * Source runner only; packaged helper paths are additionally verified by afterPack/tests. */
import { SandboxManager, VENDORED_SRT_WIN_EXE } from "@anthropic-ai/sandbox-runtime";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const isWin = process.platform === "win32";
const restricted = process.argv.includes("--expect-blocked");
const root = fs.mkdtempSync(path.join(os.homedir(), ".em-sandbox-smoke-"));
const work = path.join(root, "work"), denied = path.join(root, "secret");
fs.mkdirSync(work); fs.writeFileSync(denied, "SMOKE-SECRET");
const helper = process.platform === "linux" ? path.resolve(path.dirname(createRequire(import.meta.url).resolve("@anthropic-ai/sandbox-runtime")), "../vendor/seccomp", process.arch, "apply-seccomp") : undefined;
if (helper) fs.accessSync(helper, fs.constants.X_OK);
const config = {
  network: { allowedDomains: [], deniedDomains: [], strictAllowlist: true },
  filesystem: { denyRead: [denied], allowWrite: [work], denyWrite: [] },
  ...(helper ? { seccomp: { applyPath: helper } } : {}),
  ...(isWin ? { windows: { srtWin: { path: VENDORED_SRT_WIN_EXE } } } : {}),
};
const execute = async command => {
  const spec = isWin ? await SandboxManager.wrapWithSandboxArgv(command) : await SandboxManager.wrapWithSandbox(command);
  const result = await new Promise((resolve, reject) => {
    const child = isWin ? spawn(spec.argv[0], spec.argv.slice(1), { cwd: work, env: { ...process.env, ...spec.env } })
      : spawn(spec, { shell: true, cwd: work, detached: true });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { if (!isWin && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill(); }, 30_000);
    child.stdout.on("data", c => { stdout += c; }); child.stderr.on("data", c => { stderr += c; });
    child.once("error", reject);
    child.once("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  await SandboxManager.cleanupAfterCommand();
  return result;
};
try {
  if (restricted) {
    // First prove the outer namespace setup works; an arbitrary spawn failure is not a valid negative test.
    const baseline = await new Promise((resolve, reject) => {
      const child = spawn("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-user", "--cap-drop", "ALL", "--unshare-pid", "--unshare-net", "--proc", "/proc", "--", "/bin/echo", "OUTER-OK"]);
      let stdout = "", stderr = "";
      child.stdout.on("data", c => { stdout += c; }); child.stderr.on("data", c => { stderr += c; });
      child.once("error", reject); child.once("close", code => resolve({ code, stdout, stderr }));
    });
    assert.equal(baseline.code, 0, baseline.stderr); assert.ok(baseline.stdout.includes("OUTER-OK"));
  }
  await SandboxManager.initialize(config);
  const r = await execute("echo SMOKE-OK");
  if (restricted) {
    assert.notEqual(r.code, 0, "restricted namespace unexpectedly allowed the workload");
    assert.ok(!r.stdout.includes("SMOKE-OK"), "workload ran despite expected namespace denial");
    assert.match(r.stderr, /apply-seccomp:.*unshare/);
  } else {
    assert.equal(r.code, 0, r.stderr); assert.ok(r.stdout.includes("SMOKE-OK"));
    if (!isWin) {
      const read = await execute(`cat '${denied}'`);
      assert.notEqual(read.code, 0); assert.ok(!read.stdout.includes("SMOKE-SECRET"));
      const write = await execute(`printf bad > '${root}/outside'`);
      assert.notEqual(write.code, 0); assert.ok(!fs.existsSync(path.join(root, "outside")));
      if (helper) {
        const socket = await execute('python3 -c "import socket; socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)"');
        assert.notEqual(socket.code, 0); assert.match(socket.stderr, /[Pp]ermission|[Oo]peration not permitted/);
      }
    }
  }
  console.log(`[smoke] ${process.platform}: ${restricted ? "restricted namespace rejected before workload" : "execution and protection checks passed"}`);
} finally {
  await SandboxManager.reset();
  fs.rmSync(root, { recursive: true, force: true });
}
