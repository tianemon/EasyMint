#!/usr/bin/env node
/**
 * 主进程 / 预加载的 esbuild 构建定义——dev 与生产共用的单一真相源。
 *
 * 此前 dev（scripts/dev-electron.cjs）与生产（package.json 的 build:main 命令行）
 * 各维护一份 external 清单：xlsx→exceljs 替换时只改了生产那份，dev 产物把
 * zod/exceljs 整包打进去（2.4MB vs 884KB）。清单只此一份、两处引用，杜绝漂移。
 *
 * 用法：node scripts/build.cjs <main|preload>
 */
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");

/**
 * 不打包进 bundle、运行时从 node_modules 加载的依赖：
 * - ESM-only / 原生包（sandbox-runtime、archiver）——CJS bundle 里 require 会崩，必须外部化
 * - 体积大且无需打包的（zod、exceljs、pdf-parse 等）
 * 约束：external 化的包必须存在于生产包的 node_modules（electron-builder 按 dependencies 打包）。
 */
const EXTERNALS = [
  "electron",
  "@anthropic-ai/sandbox-runtime",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat",
  "@modelcontextprotocol/sdk",
  "@modelcontextprotocol/sdk/*",
  "electron-updater",
  "@aws-sdk/*",
  "archiver",
  "unzipper",
  "pdf-parse",
  "mammoth",
  "exceljs",
  "dompurify",
  "zod",
  "jszip",
];

function mainOptions(overrides = {}) {
  return {
    entryPoints: [path.join(ROOT, "app/main/index.ts")],
    bundle: true, platform: "node", format: "cjs",
    outfile: path.join(ROOT, "app/main/dist/main.cjs"),
    external: EXTERNALS,
    ...overrides,
  };
}

function preloadOptions(overrides = {}) {
  return {
    entryPoints: [path.join(ROOT, "app/preload/index.ts")],
    bundle: true, platform: "node", format: "cjs",
    outfile: path.join(ROOT, "app/preload/dist/preload.cjs"),
    external: ["electron"],
    ...overrides,
  };
}

module.exports = { EXTERNALS, mainOptions, preloadOptions };

// ── CLI：node scripts/build.cjs <main|preload> ──
if (require.main === module) {
  const target = process.argv[2];
  let options = null;
  if (target === "main") options = mainOptions({ logLevel: "info" });
  else if (target === "preload") options = preloadOptions({ logLevel: "info" });

  if (!options) {
    console.error("[build] 用法: node scripts/build.cjs <main|preload>");
    process.exit(1);
  }
  esbuild.build(options).catch((e) => {
    console.error("[build] 构建失败:", e.message);
    process.exit(1);
  });
}
