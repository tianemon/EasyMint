const fs = require("node:fs");
const path = require("node:path");

const target = path.join(__dirname, "..", "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
if (fs.existsSync(target)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(target, "utf-8"));
    if (pkg.piConfig?.configDir !== ".easymint") {
      pkg.piConfig = { ...pkg.piConfig, configDir: ".easymint" };
      fs.writeFileSync(target, JSON.stringify(pkg, null, 2) + "\n");
      console.log("[patch-pi-config] 已将 piConfig.configDir 设置为 .easymint:", target);
    }
  } catch (e) {
    console.warn("[patch-pi-config] 注入失败:", e.message);
  }
}
