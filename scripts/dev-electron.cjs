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

const root = path.join(__dirname, "..");
const node = process.execPath;
const electronCli = path.join(root, "node_modules", "electron", "cli.js");

const EXTERNALS = [
  "electron",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
  "electron-updater",
  // unzipper 的可选 S3 支持(运行时才 require,未安装——external 避免 bundle 失败)
  "@aws-sdk/*",
  // archiver 8.0 是纯 ESM 包,esbuild CJS bundle 跨平台解析不稳定——运行时 require
  "archiver",
  "unzipper",
  // 文档解析器:运行时按需 require(external 不进 bundle,与 build:main 一致)
  "pdf-parse",
  "mammoth",
  "xlsx",
  "jszip",
];

async function main() {
  // ── 1+2. build main + preload(esbuild JS API,等价 build:main / build:preload) ──
  await Promise.all([
    esbuild.build({
      entryPoints: [path.join(root, "app/main/index.ts")],
      bundle: true, platform: "node", format: "cjs",
      outfile: path.join(root, "app/main/dist/main.cjs"),
      external: EXTERNALS,
      logLevel: "info",
    }),
    esbuild.build({
      entryPoints: [path.join(root, "app/preload/index.ts")],
      bundle: true, platform: "node", format: "cjs",
      outfile: path.join(root, "app/preload/dist/preload.cjs"),
      external: ["electron"],
      logLevel: "info",
    }),
  ]);

  // ── 3. 启动 electron(cli.js 内部解析真实二进制并 spawn) ──
  const child = spawn(node, [electronCli, "."], { stdio: "inherit", cwd: root });
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((e) => {
  console.error("[dev-electron] 构建失败:", e.message);
  process.exit(1);
});
