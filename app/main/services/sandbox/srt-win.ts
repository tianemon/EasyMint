/**
 * Windows 专用：srt 的 `srt-win.exe` 路径注入 + 包内版本读取。
 *
 * **为什么需要这个模块（2026-09-15 用户实测踩到）**：
 * srt 的 `checkWindowsSandboxStatusAsync()` / `installWindowsSandbox()` / `uninstallWindowsSandbox()`
 * 内部都是 `opts.srtWin ?? resolveSrtWin()`，而**无参** `resolveSrtWin()` 必抛：
 *
 *     WindowsSandboxError: no srt-win path configured; set windows.srtWin.path
 *
 * （本机实测复现，与平台无关的代码路径；上游注释也写着 "Production callers set
 * `windows.srtWin.path`"）。只有 `SandboxManager.initialize(cfg)` 那条路径是从 config 的
 * `windows.srtWin.path` 读——所以「沙盒里跑命令」是好的，而**「环境检测 / 一键安装」在
 * Windows 上必失败**：两处调用没传这个参数，异常各自掉进 catch，界面于是显示"检测失败"与兜底文案。
 *
 * 安全/一致性：只使用 srt 自己导出的公开量，不手拼——
 * `prependArgs` 里的 `--srt-win` 是 srt 内部常量，由 `resolveSrtWin({ path })` 给出；
 * 我们若写死它，上游一改就静默失效。
 *
 * 两种形态别混：`SandboxManager.initialize(cfg)` 要的是 **config 形态**（`cfg.windows.srtWin.path`，
 * 见 `windows-sandbox-worker.ts`）；而 status / install / uninstall 三个接口要的是
 * **spawn 规格**（`{ exe, prependArgs }`）——就是本模块的 `srtWinSpawn()` 产出的那个。
 *
 * **第二处必踩的坑：路径必须先改掉 `.asar`（2026-09-15 用户实测的第二形态）**。
 * 打包后本模块是从 `app.asar` 内加载的，`VENDORED_SRT_WIN_EXE` 于是长这样：
 *   `<…>/resources/app.asar/node_modules/@anthropic-ai/sandbox-runtime/vendor/srt-win/x64/srt-win.exe`
 * 而 srt 内部是用 `spawn` / `spawnSync` 起它的，**Electron 只给 `execFile`/`execFileSync` 做了
 * asar 重定向**（官方 ASAR 文档「Executing Binaries Inside ASAR archive」明写：`exec` 与 `spawn`
 * 收的是 command，无法可靠替换其中的路径），于是这个路径：
 *   - `fs.existsSync()` → **true**（asar 垫片会解析 unpacked 条目）→ `resolveSrtWin` 的存在性检查拦不住；
 *   - 真去 spawn → **ENOTDIR**（`app.asar` 是文件、不是目录）→ `spawn_failed` → 调用方的 catch 吞掉
 *     → 界面恒报"未安装/检测失败"，用户装多少次都一样。
 * 实测：`__srt-win.test.ts` 里在 Electron 运行时 spawn 一个 asar 路径下的已 unpack 脚本 → ENOTDIR，
 * 同一条路径 `execFileSync` 正常。Electron fork 启动的 Node 脚本仍使用逻辑归档路径，
 * 这样脚本能够解析归档中的模块依赖。
 * 结论：**凡是交给 spawn 的 srt-win 路径都必须先过 `srtWinPath()` / `unpackedAsarPath()`**——
 * 环境检测（probe）、一键安装（run）、沙盒初始化与 worker（config 形态）四处都不能漏。
 */
import fs from "node:fs";
import path from "node:path";
import type { SrtWinSpawn, WindowsSandboxStatus } from "@anthropic-ai/sandbox-runtime";

type SrtModule = typeof import("@anthropic-ai/sandbox-runtime");

/**
 * `app.asar` 里的原生可执行文件路径 → spawn 可访问的物理路径。
 * 只改第一处 `.asar` 且要求紧跟分隔符——目录名本身含 `.asar` 的（如 `x.asar.old`）不受影响。
 */
export function unpackedAsarPath(p: string): string {
  return p.replace(/\.asar([\\/])/, ".asar.unpacked$1");
}

/** 包内 srt-win.exe 的**可执行**路径（打包后已由 `.asar` 改写到 `.asar.unpacked`） */
export function srtWinPath(srt: SrtModule): string {
  return unpackedAsarPath(srt.VENDORED_SRT_WIN_EXE);
}

/** status / install / uninstall 三类接口需要的 `srtWin` 参数（用 `{ srtWin: srtWinSpawn(srt) }` 传入） */
export function srtWinSpawn(srt: SrtModule): SrtWinSpawn {
  return srt.resolveSrtWin({ path: srtWinPath(srt) });
}

/**
 * 本应用实际打包的 srt 版本——用于把手动安装命令钉到同一版本。
 *
 * 不钉版本的话，用户 npx 拉到的是 registry 上的 latest（可能比包内那份新），装配出来的
 * 状态未必与包内这套的判定口径一致；而版本号若在代码里再写一份，就和 package.json 两处漂移
 * （本仓库栽过：external 清单两份互相漂移）。故这里从 srt 包自己的 package.json 读：
 * `VENDORED_SRT_WIN_EXE` = `<包根>/vendor/srt-win/<arch>/srt-win.exe`，其所在目录上溯三层
 * （`<arch>` → `srt-win` → `vendor`）即包根。
 * 读不到返回 undefined（调用方退化为"不钉版本"），绝不抛。
 */
export function packagedSrtVersion(srt: SrtModule): string | undefined {
  // Electron can read package metadata inside the archive. Only the executable needs an unpacked path.
  for (const exe of new Set([srt.VENDORED_SRT_WIN_EXE, srtWinPath(srt)])) {
    try {
      const pkgPath = path.join(path.dirname(exe), "..", "..", "..", "package.json");
      const { version } = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: unknown };
      if (typeof version === "string" && version.length > 0) return version;
    } catch { /* try the alternate packaged layout */ }
  }
  return undefined;
}

/** WFP enumeration may be unavailable without elevation. SRT verifies it on initialization. */
export function windowsSandboxIssue(status: WindowsSandboxStatus): string | undefined {
  const { user, wfp } = status;
  if (!user?.provisioned || !user.credPresent) return "隔离账户未就绪";
  if (user.setupVersion !== undefined && user.markerVersion !== user.setupVersion) {
    return "隔离组件版本不匹配，请到设置 → 环境检测重新准备系统保护";
  }
  if (wfp?.state === "absent") return "网络过滤未生效";
  if (wfp?.state === "loopback-mismatch" || (wfp?.state === "installed" && wfp.allowLoopback)) {
    return "网络过滤配置不匹配，请到设置 → 环境检测重新准备系统保护";
  }
  return undefined;
}
