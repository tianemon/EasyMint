const fs = require("node:fs");
const path = require("node:path");

/**
 * electron-builder afterPack 钩子:
 * 在生成最终安装包 (AppImage / dmg / nsis) 前，
 * 将 asar.unpacked 下的 @earendil-works/pi-coding-agent 的 package.json 预先写入 .easymint。
 * 避免在 Linux AppImage 等只读挂载文件系统运行时触发 EROFS 写入失败。
 *
 * 2026-10-26 起 `@earendil-works/**` 默认打进 app.asar（只解包 native/wasm），
 * 所以解包路径常常不存在——那时改从 asar 里读出来核对。真源是 postinstall 的
 * scripts/patch-pi-config.cjs，这里只负责「打包产物里到底带没带上」的验收，不再改写 asar。
 */
// Shell execution cannot use virtual ASAR paths; a Linux package must carry a real native helper.
function verifyPackagedLinuxSandbox(resources, arch) {
  const machine = { x64: 62, arm64: 183 }[arch];
  if (!machine) throw new Error(`Unsupported Linux sandbox architecture: ${arch}`);
  const helper = path.join(resources, "app.asar.unpacked/node_modules/@anthropic-ai/sandbox-runtime/vendor/seccomp", arch, "apply-seccomp");
  const stat = fs.statSync(helper);
  if (!stat.isFile() || !(stat.mode & 0o111)) throw new Error("Packaged Linux sandbox helper is not executable");
  const header = fs.readFileSync(helper).subarray(0, 20);
  if (header.length < 20 || header.toString("hex", 0, 4) !== "7f454c46" || header[5] !== 1 || header.readUInt16LE(18) !== machine) {
    throw new Error("Packaged Linux sandbox helper architecture mismatch");
  }
}
exports.verifyPackagedLinuxSandbox = verifyPackagedLinuxSandbox;

exports.default = async function (context) {
  const { appOutDir } = context;
  if (context.electronPlatformName === "linux") {
    const arch = typeof context.arch === "string" ? context.arch : require("electron-builder").Arch[context.arch];
    verifyPackagedLinuxSandbox(path.join(appOutDir, "resources"), arch);
  }
  if (context.electronPlatformName === "win32") {
    const { verifyPackagedWindowsRuntime, contextArchitecture } = require("./prepare-windows-runtime.cjs");
    await verifyPackagedWindowsRuntime(path.join(appOutDir, "resources"), contextArchitecture(context));
  }
  const resourcesDirs = [
    path.join(appOutDir, "resources"),
    path.join(appOutDir, "EasyMint.app", "Contents", "Resources"),
  ];

  const readPackedPackageJson = (resources) => {
    const archive = path.join(resources, "app.asar");
    if (!fs.existsSync(archive)) return null;
    try {
      // 按需加载：缺包时不要连带把整个打包打挂，降级成「校验跳过」
      const asar = require("@electron/asar");
      return JSON.parse(
        asar.extractFile(archive, "node_modules/@earendil-works/pi-coding-agent/package.json").toString("utf-8"),
      );
    } catch {
      return null;
    }
  };

  for (const resources of resourcesDirs) {
    if (!fs.existsSync(resources)) continue;

    // ① 解包形态：直接改写（保留原有行为——只读文件系统上运行时改不了）
    let patched = false;
    const unpackedPath = path.join(
      resources, "app.asar.unpacked", "node_modules", "@earendil-works", "pi-coding-agent", "package.json",
    );
    if (fs.existsSync(unpackedPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(unpackedPath, "utf-8"));
        if (pkg.piConfig?.configDir !== ".easymint") {
          pkg.piConfig = { ...pkg.piConfig, configDir: ".easymint" };
          fs.writeFileSync(unpackedPath, JSON.stringify(pkg, null, 2));
          console.log("[after-pack] 已成功在打包产物中注入 piConfig.configDir: .easymint ->", unpackedPath);
        }
        patched = true;
      } catch (e) {
        console.warn("[after-pack] 注入失败:", e.message);
      }
    }
    if (patched) continue;

    // ② 打进 asar 的形态：只核对，不改写
    const pkg = readPackedPackageJson(resources);
    if (!pkg) {
      console.warn("[after-pack] 未找到 pi-coding-agent/package.json（解包与 asar 内都没有），跳过 piConfig 校验");
    } else if (pkg.piConfig?.configDir !== ".easymint") {
      console.error(
        "[after-pack] ⚠️ asar 内的 pi SDK 未定制 configDir（期望 .easymint，实际",
        pkg.piConfig?.configDir ?? "未设置",
        "）：用户新建项目会落在 .pi/。打包前请执行 node scripts/patch-pi-config.cjs",
      );
    } else {
      console.log("[after-pack] asar 内 piConfig.configDir 校验通过: .easymint");
    }
  }
};
