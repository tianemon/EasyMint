import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { unpackedAsarPath } from "./srt-win";

/** SRT 0.0.75 resolves vendor relative to its entry; shell commands cannot execute virtual ASAR paths.
 * https://www.electronjs.org/docs/latest/tutorial/asar-archives#executing-binaries-inside-asar-archive
 * Resolve only the bundled dependency, never a global npm fallback. */
export function linuxSandboxHelper(entry?: string, arch = process.arch): string {
  if (arch !== "x64" && arch !== "arm64") throw new Error(`Unsupported Linux sandbox architecture: ${arch}`);
  const resolved = entry ?? createRequire(path.join(__dirname, "srt-linux.cjs")).resolve("@anthropic-ai/sandbox-runtime");
  const helper = unpackedAsarPath(path.resolve(path.dirname(resolved), "..", "vendor", "seccomp", arch, "apply-seccomp"));
  if (!fs.statSync(helper).isFile()) throw new Error(`Linux sandbox helper is not a file: ${helper}`);
  fs.accessSync(helper, fs.constants.X_OK);
  return helper;
}

export function linuxSandboxConfig(config: SandboxRuntimeConfig): SandboxRuntimeConfig {
  return { ...config, seccomp: { ...config.seccomp, applyPath: linuxSandboxHelper() } };
}

/** Probe the namespace and helper chain used by SRT, not just bwrap's version/PID isolation. */
export function linuxSandboxProbeArgs(helper = linuxSandboxHelper()): string[] {
  return ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-user", "--cap-drop", "ALL", "--unshare-pid", "--unshare-net",
    "--", helper, "/bin/sh", "-c", "printf '__EM_SANDBOX_OK__'"];
}
