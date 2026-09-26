#!/usr/bin/env node
/**
 * 幽灵依赖检查（phantom dependency）：**代码里 import 了、package.json 却没声明**的包。
 *
 * 为什么需要：`app/main/services/network-service.ts` 直接 `import { WebSocketServer } from "ws"`，
 * 而 package.json 从未声明 ws —— 它能跑纯粹是因为 `@earendil-works/pi-ai` → `openai` / `@google/genai`
 * 也依赖 ws，被 npm 扁平化到了顶层 node_modules。**pi 系列依赖树一变（换版本、改嵌套安装、换包），
 * `network-service` 立刻崩，而且构建期不会报错**（external 化后是运行时 require 才炸）。
 *
 * 判据：代码 import 的裸包名是否出现在 package.json 的 dependencies / devDependencies /
 * optionalDependencies / peerDependencies 之一。**误报来源已排除三类**：
 *   - 相对/绝对路径与 `node:` 前缀
 *   - Node 内置模块（取自 `node:module` 的 builtinModules，含无前缀写法如 `fs`）
 *   - tsconfig 的路径别名（`@shared/*` 等，从各 tsconfig 的 compilerOptions.paths 读取，不硬编码）
 *
 * 不扫 `*.test.ts`：本检查保的是打包产物（external 化后运行时 require 才炸的那类），
 * 测试文件不进产物；且测试里的扩展源码夹具（fingerprint 等扫描的对象）按设计就包含
 * 虚构包名的 import 字符串，逐行正则无法与真实 import 区分。
 *
 * 用法：node scripts/check-deps.mjs（已接入 `npm run lint`）；有问题时 exit 1。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app"];
const TSCONFIGS = [
  "tsconfig.json",
  "app/main/tsconfig.json",
  "app/preload/tsconfig.json",
  "app/renderer/tsconfig.json",
];

/** 从各 tsconfig 收集路径别名前缀（`@shared/*` → `@shared`）；解析失败不致命，只提示 */
function collectAliases() {
  const aliases = new Set();
  for (const rel of TSCONFIGS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      const raw = fs.readFileSync(abs, "utf-8").replace(/\/\/.*$/gm, "");
      const paths = JSON.parse(raw)?.compilerOptions?.paths ?? {};
      for (const key of Object.keys(paths)) {
        aliases.add(key.endsWith("/*") ? key.slice(0, -2) : key);
      }
    } catch (e) {
      console.warn(`[check-deps] 跳过 ${rel}（解析失败：${e.message}）`);
    }
  }
  return aliases;
}

/** 递归收集待扫描的源文件 */
function collectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "dist" || entry.name === "node_modules") continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(abs));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) out.push(abs);
  }
  return out;
}

/** 包名：scope 包取前两段（@scope/name），其余取第一段 */
function packageNameOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g;

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
  const builtins = new Set(builtinModules);
  const aliases = collectAliases();

  const files = SCAN_DIRS.flatMap((d) => collectFiles(path.join(ROOT, d)));
  /** 包名 → { at: "文件:行", count } */
  const phantoms = new Map();

  for (const abs of files) {
    const lines = fs.readFileSync(abs, "utf-8").split("\n");
    lines.forEach((line, idx) => {
      for (const m of line.matchAll(IMPORT_RE)) {
        const spec = m[1];
        if (!spec || spec.startsWith(".") || spec.startsWith("/")) continue;
        if (spec.startsWith("node:")) continue;
        const name = packageNameOf(spec);
        if (builtins.has(name)) continue;
        if ([...aliases].some((a) => name === a || spec.startsWith(a + "/"))) continue;
        if (declared.has(name)) continue;
        const prev = phantoms.get(name);
        phantoms.set(name, {
          at: prev?.at ?? `${path.relative(ROOT, abs)}:${idx + 1}`,
          count: (prev?.count ?? 0) + 1,
        });
      }
    });
  }

  if (phantoms.size === 0) {
    console.log(`[check-deps] ✓ 扫描 ${files.length} 个源文件，无未声明依赖`);
    return 0;
  }

  console.error(`[check-deps] ✗ 发现 ${phantoms.size} 个未声明依赖（代码 import 了，package.json 没写）：`);
  for (const [name, info] of [...phantoms].sort()) {
    console.error(`   ${name.padEnd(30)} ${info.at}${info.count > 1 ? `（共 ${info.count} 处）` : ""}`);
  }
  console.error(
    "\n处置：补进 dependencies（并用 @electron/asar 的 listPackage() 核实它会进打包产物）；" +
      "若只是类型引用或误写，改为相对导入。",
  );
  return 1;
}

process.exit(main());
