import fs from "node:fs";
import path from "node:path";

/** Resolve afresh: GUI processes keep an old PATH after the user installs CodeGraph. */
export function codegraphEnvironment(source: NodeJS.ProcessEnv = process.env, platform = process.platform): NodeJS.ProcessEnv {
  const env = { ...source };
  const pathValue = source.PATH ?? Object.entries(source).find(([key]) => key.toUpperCase() === "PATH")?.[1];
  const dirs = platform === "win32"
    ? [
        source.CODEGRAPH_INSTALL_DIR && path.win32.join(source.CODEGRAPH_INSTALL_DIR, "current", "bin"),
        source.LOCALAPPDATA && path.win32.join(source.LOCALAPPDATA, "codegraph", "current", "bin"),
        source.APPDATA && path.win32.join(source.APPDATA, "npm"),
        source.ProgramFiles && path.win32.join(source.ProgramFiles, "nodejs"),
      ]
    : ["/opt/homebrew/bin", "/usr/local/bin"];
  const sep = platform === "win32" ? ";" : ":";
  const value = [pathValue, ...dirs].filter(Boolean).join(sep);
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = value;
  return env;
}

export function codegraphCandidates(env: NodeJS.ProcessEnv, platform = process.platform): string[] {
  if (platform !== "win32") return ["codegraph", "/usr/local/bin/codegraph", "/opt/homebrew/bin/codegraph"];
  // Resolve batch launchers without executing them, so a broken PATH installation is still
  // reported as a probe error. Git Bash does not resolve the .cmd suffix of bare commands.
  return [...new Set((env.PATH ?? "").split(";").filter(Boolean).flatMap(dir =>
    ["codegraph.exe", "codegraph.cmd", "codegraph.bat"].map(leaf => path.win32.join(dir.replace(/^"|"$/g, ""), leaf)),
  ))].filter(candidate => fs.existsSync(candidate));
}

/** Use the standalone bundle's own runtime in both the detector and the protected transport.
 * npm installs also include an extensionless shell shim, which Git Bash can execute. */
export function codegraphInvocation(command: string, args: string[], env: NodeJS.ProcessEnv, platform = process.platform): { command: string; args: string[]; shellCommand?: string } {
  if (platform !== "win32") return { command, args };
  const launcher = /^(codegraph|codegraph\.cmd)$/i.test(command) ? codegraphCandidates(env, platform)[0] : command;
  if (!launcher || !/codegraph\.cmd$/i.test(launcher)) return { command: launcher ?? command, args };
  const root = path.win32.dirname(path.win32.dirname(launcher));
  const node = path.win32.join(root, "node.exe");
  const script = path.win32.join(root, "lib", "dist", "bin", "codegraph.js");
  if (fs.existsSync(node) && fs.existsSync(script)) return { command: node, args: [script, ...args] };
  const shellShim = launcher.slice(0, -4);
  return { command: launcher, args, shellCommand: fs.existsSync(shellShim) ? shellShim : undefined };
}
