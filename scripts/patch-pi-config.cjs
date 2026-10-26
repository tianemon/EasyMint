/**
 * Pi SDK 品牌定制：项目级配置目录 .pi → .easymint。
 *
 * 上游读取点固定为 `dist/config.js` 里的 `pkg.piConfig?.configDir || ".pi"`。
 * 这个补丁原来只用一个 try/catch 吞错，字段被改名或读取点被移除时会**静默失效**：
 * 配置目录回落到 .pi，用户已有项目里的 .easymint/settings.json 读不到，表现为"设置凭空丢失"。
 * 所以这里做两层 fail-closed 校验，且用文本特征而非版本号：
 * 上游升版本只要读取点还在就继续可用，改掉就构建期直接失败，不会带病出包。
 */
const fs = require("node:fs");
const path = require("node:path");

const pkgRoot = path.join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent");
const target = path.join(pkgRoot, "package.json");
const configJs = path.join(pkgRoot, "dist", "config.js");

if (!fs.existsSync(target) || !fs.existsSync(configJs)) {
  throw new Error(`[patch-pi-config] pi-coding-agent 结构异常（缺 package.json 或 dist/config.js）：${pkgRoot}`);
}

if (!/piConfig\?\.configDir/.test(fs.readFileSync(configJs, "utf8"))) {
  throw new Error(
    "[patch-pi-config] 上游 dist/config.js 已不读 piConfig.configDir。" +
      "继续构建会让项目级配置目录回落到 .pi，用户已有项目的 .easymint/ 设置将读不到。" +
      "请更新 scripts/patch-pi-config.cjs 的定制点，并检查上游是否换了品牌化机制。",
  );
}

const pkg = JSON.parse(fs.readFileSync(target, "utf-8"));
if (pkg.piConfig?.configDir !== ".easymint") {
  pkg.piConfig = { ...pkg.piConfig, configDir: ".easymint" };
  fs.writeFileSync(target, JSON.stringify(pkg, null, 2) + "\n");
  console.log("[patch-pi-config] 已将 piConfig.configDir 设置为 .easymint:", target);
}

const applied = JSON.parse(fs.readFileSync(target, "utf-8")).piConfig?.configDir;
if (applied !== ".easymint") {
  throw new Error(`[patch-pi-config] 写入后校验失败（当前值 ${String(applied)}），拒绝带病构建`);
}
