#!/usr/bin/env node
/** Cross-platform dependency installation with Electron's supported mirror environment variable. */
const { spawn } = require("node:child_process");
const path = require("node:path");

const DEFAULT_ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/";
function installationEnvironment(environment) {
  return { ...environment, ELECTRON_MIRROR: environment.ELECTRON_MIRROR ?? DEFAULT_ELECTRON_MIRROR };
}
function install(mode = "install") {
  if (mode !== "install" && mode !== "ci") throw new Error("Usage: node scripts/install-deps.cjs [install|ci]");
  const environment = installationEnvironment(process.env);
  // npm_execpath avoids shell wrappers when invoked with npm run install:deps.
  // Direct Windows invocation uses cmd with a fixed, validated command only.
  const [command, args] = process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath, mode]]
    : process.platform === "win32"
      ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm ${mode}`]]
      : ["npm", [mode]];
  const child = spawn(command, args, { cwd: path.join(__dirname, ".."), env: environment, stdio: "inherit" });
  child.once("error", error => { console.error(error.message); process.exitCode = 1; });
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
module.exports = { installationEnvironment, install };
if (require.main === module) {
  if (process.argv.includes("--help")) console.log("Usage: node scripts/install-deps.cjs [install|ci]\nUses ELECTRON_MIRROR when set; otherwise uses the project mirror.");
  else {
    try { install(process.argv[2]); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
