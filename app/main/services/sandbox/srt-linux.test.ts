import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { linuxSandboxHelper, linuxSandboxProbeArgs } from "./srt-linux";

const roots: string[] = [];
const root = () => { const r = fs.mkdtempSync(path.join(os.tmpdir(), "em-linux-sandbox-")); roots.push(r); return r; };
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

describe("Linux trusted helper", () => {
  it("uses unpacked package helper even though an archive path exists", () => {
    const r = root(), pkg = path.join(r, "app.asar.unpacked/node_modules/@anthropic-ai/sandbox-runtime");
    const helper = path.join(pkg, "vendor/seccomp/x64/apply-seccomp");
    fs.mkdirSync(path.dirname(helper), { recursive: true }); fs.writeFileSync(helper, "fixture", { mode: 0o755 });
    fs.writeFileSync(path.join(r, "app.asar"), "archive-file");
    expect(linuxSandboxHelper(path.join(r, "app.asar/node_modules/@anthropic-ai/sandbox-runtime/dist/index.js"), "x64")).toBe(helper);
  });
  it("rejects missing/nonexecutable helpers instead of falling back to global npm", () => {
    const r = root(), entry = path.join(r, "pkg/dist/index.js");
    expect(() => linuxSandboxHelper(entry, "x64")).toThrow();
    const helper = path.join(r, "pkg/vendor/seccomp/x64/apply-seccomp");
    fs.mkdirSync(path.dirname(helper), { recursive: true }); fs.writeFileSync(helper, "fixture", { mode: 0o644 });
    expect(() => linuxSandboxHelper(entry, "x64")).toThrow();
    expect(() => linuxSandboxHelper(entry, "ia32")).toThrow(/architecture/);
  });
  it("probes network/user/PID namespaces with fresh proc, dropped caps and actual helper", () => {
    const args = linuxSandboxProbeArgs("/pkg/helper with space");
    for (const flag of ["--unshare-user", "--unshare-net", "--unshare-pid", "--proc", "--cap-drop"]) expect(args).toContain(flag);
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["/pkg/helper with space", "/bin/sh", "-c", "printf '__EM_SANDBOX_OK__'"]);
  });
});

describe("Linux package verification", () => {
  const { verifyPackagedLinuxSandbox: verify } = createRequire(path.join(__dirname, "srt-linux.test.cjs"))(path.resolve("scripts/after-pack.cjs"));
  it("requires a real executable ELF of the selected architecture", () => {
    const r = root(), h = path.join(r, "app.asar.unpacked/node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp/x64/apply-seccomp");
    expect(() => verify(r, "x64")).toThrow();
    fs.mkdirSync(path.dirname(h), { recursive: true });
    const elf = Buffer.alloc(20); elf.write("\x7fELF"); elf[5] = 1; elf.writeUInt16LE(62, 18);
    fs.writeFileSync(h, elf, { mode: 0o755 }); expect(() => verify(r, "x64")).not.toThrow();
    fs.chmodSync(h, 0o644); expect(() => verify(r, "x64")).toThrow(/executable/);
    fs.chmodSync(h, 0o755); elf.writeUInt16LE(183, 18); fs.writeFileSync(h, elf); expect(() => verify(r, "x64")).toThrow(/architecture/);
  });
});
