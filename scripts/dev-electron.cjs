#!/usr/bin/env node
/**
 * dev:electron 的 node 直启版本——绕过 npm run / .cmd 批处理包装。
 *
 * 背景: Windows 上 `npm run xxx` 解析为 npm.cmd 由 cmd.exe 执行,
 * Ctrl+C 终止时 cmd 询问"终止批处理操作吗(Y/N)?"(GBK 编码→终端乱码)。
 * 本脚本用 esbuild JS API 构建 + electron cli 启动,全链路无 cmd 批处理层。
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const esbuild = require("esbuild");
const { mainOptions, preloadOptions } = require("./build.cjs");

const root = path.join(__dirname, "..");
const node = process.execPath;
const electronCli = path.join(root, "node_modules", "electron", "cli.js");

async function main() {
  // ── 1+2. build main + preload（构建配置见 build.cjs，与生产构建共用同一份）──
  await Promise.all([
    esbuild.build(mainOptions({ logLevel: "info" })),
    esbuild.build(preloadOptions({ logLevel: "info" })),
  ]);

  // ── 3. 启动 electron(cli.js 内部解析真实二进制并 spawn) ──
  const child = spawn(node, [electronCli, "."], { stdio: "inherit", cwd: root });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error("[dev-electron] 构建失败:", e.message);
  process.exit(1);
});
