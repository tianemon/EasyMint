/**
 * 运行时 Dock 图标（仅 macOS）：跟随应用的实际主题（亮/暗）切换。
 *
 * 三个图标口径并存，不要混用：
 *  - mac 包内图标（assets/icon.icns）：满幅直角，形状交给 macOS 26 系统自己套；
 *  - 非 mac 包内图标（assets/icon.png｜icon.ico）：Windows/Linux 不套形状，用自带形状的
 *    圆角图（本体占画布 80.5% + 超椭圆遮罩，与 mac 系统渲染出来的观感一致）；
 *  - 运行时图标（assets/appicon-{light,dark}.png）：同「自带形状」口径，随主题切。
 *    四种产物由 scripts/gen-appicon.py 生成，改素材后重跑该脚本。
 *
 * WHY 运行时图标必须自带形状：`app.dock.setIcon()` 的图不经过系统的图标遮罩流程
 * （只有 bundle 图标会被套上圆角/超椭圆），所以运行时这张图若也用满幅直角口径，
 * Dock 里会呈现一个直角方块；反过来 bundle 图标若用了自带形状的图，系统会再套一层，
 * 出现两套形状叠加的断层。
 */
import path from "node:path";
import { app, nativeImage } from "electron";

export type EffectiveTheme = "light" | "dark";

/** 运行时 Dock 图标绝对路径。
 *  打包后由 electron-builder 的 extraResources 输出到 asar 外的 Resources/ 根，
 *  与项目其它运行时资源（template / skills / em-html-editor / brand-tokens）同一口径：
 *  路径基准统一是 process.resourcesPath；dev 下取项目根的 assets/。 */
export function getDockIconPath(theme: EffectiveTheme): string {
  const fileName = `appicon-${theme}.png`;
  return app.isPackaged
    ? path.join(process.resourcesPath, fileName)
    : path.join(__dirname, "..", "..", "..", "assets", fileName);
}

/** 按当前生效主题切换 Dock 图标；非 macOS 平台安全跳过（app.dock 仅 macOS 存在）。
 *  注意：应用**有窗口之前**调用它不会立刻改变可见的 Dock 图标（macOS 在 JS 执行前已用 bundle 图标
 *  画好了启动阶段的 tile，首次可见重绘发生在窗口出现后）——实测取证见 docs/开发记录 2026-09-12。 */
export function applyDockIcon(theme: EffectiveTheme): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const iconPath = getDockIconPath(theme);
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    // 图标文件缺失/损坏只影响 Dock 展示，不阻断主题切换本身——记日志后放弃本次切换
    console.error(`[appearance] Dock 图标读取失败，已跳过切换: ${iconPath}`);
    return;
  }
  app.dock.setIcon(icon);
}
