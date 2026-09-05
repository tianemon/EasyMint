const fs = require("node:fs");
const path = require("node:path");

/**
 * electron-builder afterPack 钩子:
 * 在生成最终安装包 (AppImage / dmg / nsis) 前，
 * 将 asar.unpacked 下的 @earendil-works/pi-coding-agent 的 package.json 预先写入 .easymint。
 * 避免在 Linux AppImage 等只读挂载文件系统运行时触发 EROFS 写入失败。
 */
exports.default = async function (context) {
  const { appOutDir } = context;
  const candidates = [
    path.join(appOutDir, "resources", "app.asar.unpacked", "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
    path.join(appOutDir, "EasyMint.app", "Contents", "Resources", "app.asar.unpacked", "node_modules", "@earendil-works", "pi-coding-agent", "package.json"),
  ];

  for (const pkgPath of candidates) {
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.piConfig?.configDir !== ".easymint") {
          pkg.piConfig = { ...pkg.piConfig, configDir: ".easymint" };
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
          console.log("[after-pack] 已成功在打包产物中注入 piConfig.configDir: .easymint ->", pkgPath);
        }
      } catch (e) {
        console.warn("[after-pack] 注入失败:", e.message);
      }
    }
  }
};
