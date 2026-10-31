import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPARMOR_PROFILES_PACKAGE, buildInstallArgv, buildPackageArgv, distroManualInstallCommand,
  formatCommand, hasDistroManualCommand, manualInstallCommand, parseOsRelease, readDistro,
  resolveInstaller, resolvePkexec, resolveUsernsProfileSource, usernsCopyArgv, usernsFixAvailable,
  usernsLoadArgv, usernsManualCommand, usernsProfileInstalled, windowsInstallCommand, type Installer,
} from "./plan";
import { prependPathDirs, probeBinary, probeEnvironment, type ProbeDeps, type ProbeOutcome } from "./probe";

/**
 * srt 打桩：Windows 分支的回归测试用（真实模块是 ESM-only、且要 Windows 才跑得起来）。
 * exe 路径做成可变属性 —— 测试先造好"包内 srt"的目录形状（含 package.json 版本），
 * 再调 probeEnvironment，这样版本钉取逻辑也一并被覆盖。
 */
// Platform-injected Windows cases must not inspect or execute the real user's prepared runtime.
vi.mock("../windows-runtime", () => ({ probeWindowsRuntime: async () => ({ status: "missing" }) }));
const srtHarness = vi.hoisted(() => ({ calls: [] as unknown[], exe: "C:\\none\\vendor\\srt-win\\x64\\srt-win.exe" }));
vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  get VENDORED_SRT_WIN_EXE() { return srtHarness.exe; },
  resolveSrtWin: (cfg: { path: string }) => ({ exe: cfg.path, prependArgs: ["--srt-win"] }),
  checkWindowsSandboxStatusAsync: async (opts: unknown) => {
    srtHarness.calls.push(opts);
    return { user: { provisioned: false, credPresent: false }, wfp: { state: "absent" } };
  },
}));

/** 与 plan.ts 的常量同源的钉子：命令与指引必须指向同一处 */
const USERNS_DEST = "/etc/apparmor.d/bwrap-userns-restrict";
const USERNS_SRC = "/usr/share/apparmor/extra-profiles/bwrap-userns-restrict";
const PKEXEC = "/usr/bin/pkexec";
const INSTALL_BIN = "/usr/bin/install";
const PARSER = "/usr/sbin/apparmor_parser";
const aSet = (...paths: string[]) => (p: string): boolean => paths.includes(p);

const aptInstaller = (exists = () => true): Installer | null =>
  resolveInstaller({ id: "ubuntu", idLike: [] }, exists);

/** 单测不依赖宿主文件系统：默认"包管理器都在"（真实存在的判定另有测试覆盖） */
const resolve = (id: string, idLike: string[] = [], exists: (p: string) => boolean = () => true) =>
  resolveInstaller({ id, idLike }, exists);

describe("发行版识别", () => {
  it("解析 /etc/os-release（值可带引号）", () => {
    const parsed = parseOsRelease('ID=ubuntu\nVERSION_ID="24.04"\nID_LIKE=debian\n');
    expect(parsed).toEqual({ id: "ubuntu", versionId: "24.04", idLike: ["debian"] });
  });

  it("未知发行版不猜命令", () => {
    const parsed = parseOsRelease("ID=someexotic\n");
    expect(resolveInstaller(parsed)).toBeNull();
  });

  it("按 ID 命中四大家族，且要求包管理器真实存在", () => {
    expect(resolve("fedora")?.kind).toBe("dnf");
    expect(resolve("arch")?.kind).toBe("pacman");
    expect(resolve("opensuse-leap")?.kind).toBe("zypper");
    // 认得发行版但机器上没有对应包管理器 → 不能生成命令
    expect(resolve("ubuntu", [], () => false)).toBeNull();
  });

  it("ID_LIKE 兜底（如 linuxmint 标 debian）", () => {
    expect(resolve("unknown-distro", ["debian"])?.kind).toBe("apt");
  });

  it("readDistro 保留 ID_LIKE，供衍生发行版的执行阶段继续解析安装器", () => {
    const distro = readDistro(
      () => 'ID=elementary\nID_LIKE="ubuntu debian"\nVERSION_ID=8\n',
      "linux",
      (p) => p === "/usr/bin/apt-get",
    );
    expect(distro).toEqual({ id: "elementary", idLike: ["ubuntu", "debian"], versionId: "8", autoInstallable: true });
    expect(resolveInstaller({ id: distro.id, idLike: distro.idLike ?? [] }, (p) => p === "/usr/bin/apt-get")?.kind).toBe("apt");
  });

  it("非 Linux 平台没有包管理器这一层（必须注入平台，别拿宿主平台当断言对象）", () => {
    // 曾踩：本用例原先直接调 `readDistro()`，于是断言的对象变成「跑测试的那台机器」——
    // macOS 开发机走 platform!=="linux" 分支恰好通过，Linux CI 上则真读到 /etc/os-release
    // 得到 autoInstallable=true → 红。测试要钉代码逻辑，不能钉宿主环境。
    expect(readDistro(() => "", "darwin", () => true).autoInstallable).toBe(false);
    expect(readDistro(() => "", "win32", () => true).autoInstallable).toBe(false);
    // 反向也要钉住：Linux 上确实会给出可安装性（假文件系统，全程不碰真实 /etc/os-release）
    const linux = readDistro(() => "ID=ubuntu\n", "linux", (p) => p === "/usr/bin/apt-get");
    expect(linux.id).toBe("ubuntu");
    expect(linux.autoInstallable).toBe(true);
    // 同是 Linux，但没有可用的包管理器 → 不可自动安装（转自助指引）
    expect(readDistro(() => "ID=ubuntu\n", "linux", () => false).autoInstallable).toBe(false);
  });
});

describe("安装命令白名单", () => {
  it("生成 pkexec + 绝对路径包管理器 + 常量包名", () => {
    expect(buildInstallArgv(["bwrap", "socat", "rg"], aptInstaller())).toEqual([
      "/usr/bin/pkexec", "/usr/bin/apt-get", "install", "-y", "--no-install-recommends",
      "bubblewrap", "socat", "ripgrep",
    ]);
  });

  it("包名去重（重复请求同一项只装一次）", () => {
    const argv = buildInstallArgv(["rg", "rg"], aptInstaller());
    expect(argv?.filter((a) => a === "ripgrep")).toHaveLength(1);
  });

  it("拒绝白名单外的条目 / 需人工处理的条目（整批拒绝，不做部分猜测）", () => {
    expect(buildInstallArgv(["userns"], aptInstaller())).toBeNull();
    expect(buildInstallArgv(["bwrap", "evil-package"], aptInstaller())).toBeNull();
    expect(buildInstallArgv(["bwrap; rm -rf /"], aptInstaller())).toBeNull();
    expect(buildInstallArgv([], aptInstaller())).toBeNull();
  });

  it("没有可用包管理器时不产出命令（界面转自助安装）", () => {
    expect(buildInstallArgv(["bwrap"], null)).toBeNull();
  });

  it("自助命令去掉 pkexec 换 sudo，供用户自己跑", () => {
    const cmd = manualInstallCommand(["bwrap", "rg"], aptInstaller());
    expect(cmd).toBe("sudo /usr/bin/apt-get install -y --no-install-recommends bubblewrap ripgrep");
  });

  it("命令格式化只加引号，不引入 shell 语法", () => {
    expect(formatCommand(["sudo", "/opt/my dir/x", "a'b"])).toBe(`sudo '/opt/my dir/x' 'a'\\''b'`);
  });
});

describe("探测三态（防假检测的核心）", () => {
  const deps = (opts: { exists?: string[]; ok?: string[] }): ProbeDeps => {
    const existsSet = new Set(opts.exists ?? []);
    const okSet = new Set(opts.ok ?? []);
    return {
      exists: (p) => existsSet.has(p),
      run: (cmd) => (okSet.has(cmd) ? { status: 0, stdout: "v1\n" } : { status: 127, stdout: "" }),
    };
  };

  it("裸命令名走 PATH 成功 → ok（PATH 前置过的候选表能救回 GUI 进程的快照）", () => {
    expect(probeBinary(["rg", "/usr/bin/rg"], ["--version"], deps({ ok: ["rg"] }))).toEqual({ status: "ok", version: "v1" });
  });

  it("绝对路径存在但执行失败 → unknown（装了但启不来，绝不能报未安装）", () => {
    expect(probeBinary(["rg", "/usr/bin/rg"], ["--version"], deps({ exists: ["/usr/bin/rg"] }))).toEqual({ status: "unknown" });
  });

  it("候选都不存在 → missing（真没装）", () => {
    expect(probeBinary(["rg", "/usr/bin/rg"], ["--version"], deps({}))).toEqual({ status: "missing" });
  });

  it("绝对路径候选不存在就跳过（不把 ENOENT 当成装了但失败）", () => {
    const run = vi.fn(() => ({ status: 127, stdout: "" }));
    const out = probeBinary(["/opt/nope/rg"], ["--version"], { exists: () => false, run });
    expect(out).toEqual({ status: "missing" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("探测环境", () => {
  it("PATH 前置去重（GUI 进程快照里缺的目录补在最前）", () => {
    const env = prependPathDirs({ PATH: "/usr/bin:/opt/extra" }, ["/opt/extra", "/snap/bin"]);
    expect(env.PATH).toBe("/opt/extra:/snap/bin:/usr/bin");
  });
});

describe("userns 放行的一键修复：计划层（纯函数）", () => {
  const apt = resolveInstaller({ id: "ubuntu", idLike: [] }, () => true);

  it("profile 模板来源：按候选顺序取第一个存在的", () => {
    expect(resolveUsernsProfileSource(aSet(USERNS_SRC))).toBe(USERNS_SRC);
    expect(resolveUsernsProfileSource(aSet("/usr/share/doc/apparmor-profiles/extras/bwrap-userns-restrict")))
      .toBe("/usr/share/doc/apparmor-profiles/extras/bwrap-userns-restrict");
    expect(resolveUsernsProfileSource(aSet())).toBeNull();
  });

  it("目标 profile 已在 → 视为已装（幂等，不覆盖）", () => {
    expect(usernsProfileInstalled(aSet(USERNS_DEST))).toBe(true);
    expect(usernsProfileInstalled(aSet(USERNS_SRC))).toBe(false);
  });

  it("复制命令：用系统 install 传参，不起 shell、不用重定向", () => {
    expect(usernsCopyArgv(USERNS_SRC, aSet(INSTALL_BIN))).toEqual([
      "/usr/bin/pkexec", INSTALL_BIN, "-m", "0644", USERNS_SRC, USERNS_DEST,
    ]);
    // 没有 install（coreutils）→ 不做
    expect(usernsCopyArgv(USERNS_SRC, aSet())).toBeNull();
  });

  it("加载命令：apparmor_parser -r（未加载时会新建，不必重启）", () => {
    expect(usernsLoadArgv(aSet(PARSER))).toEqual(["/usr/bin/pkexec", PARSER, "-r", USERNS_DEST]);
    expect(usernsLoadArgv(aSet())).toBeNull();
  });

  it("能否一键修复：需要工具齐备（含 pkexec），且模板已有或能装到", () => {
    const bins = [PKEXEC, INSTALL_BIN, PARSER];
    expect(usernsFixAvailable(apt, aSet(...bins, USERNS_SRC))).toBe(true);      // 模板已在
    expect(usernsFixAvailable(apt, aSet(...bins))).toBe(true);                  // 模板缺但能装
    expect(usernsFixAvailable(null, aSet(...bins))).toBe(false);                // 模板缺且无包管理器
    expect(usernsFixAvailable(apt, aSet(INSTALL_BIN, PARSER, USERNS_SRC))).toBe(false); // 缺 pkexec
    expect(usernsFixAvailable(apt, aSet(PKEXEC, PARSER, USERNS_SRC))).toBe(false);      // 缺 install
    expect(usernsFixAvailable(apt, aSet(PKEXEC, INSTALL_BIN, USERNS_SRC))).toBe(false); // 缺解析器
    expect(usernsFixAvailable(apt, aSet(PKEXEC, ...bins, USERNS_SRC, USERNS_DEST))).toBe(false); // 已装好
  });

  it("pkexec 是否存在：只看机器上那个能弹授权的程序，与发行版是否被认识无关", () => {
    expect(resolvePkexec(aSet(PKEXEC))).toBe(PKEXEC);
    expect(resolvePkexec(aSet("/bin/pkexec"))).toBe("/bin/pkexec"); // merged-usr 之外的老布局
    expect(resolvePkexec(aSet())).toBeNull();                       // WSL / 精简镜像 / 无 polkit 桌面
  });

  it("手工指引：官方三步，且与命令指向同一份 profile / 同一个包", () => {
    const cmd = usernsManualCommand();
    const lines = cmd.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain(APPARMOR_PROFILES_PACKAGE);
    expect(lines[1]).toContain(USERNS_SRC);
    expect(lines[1]).toContain(USERNS_DEST);
    expect(lines[2]).toContain(USERNS_DEST);
    expect(lines[2]).toContain("apparmor_parser -r");
    // 指引里**不能**出现"全局关掉 userns 限制"那条（会扩大所有进程的攻击面）
    expect(cmd).not.toContain("sysctl");
  });

  it("包名常量构造（不经过 id 白名单，但同样只吃本文件常量）", () => {
    expect(buildPackageArgv(["apparmor-profiles"], apt)).toEqual([
      "/usr/bin/pkexec", "/usr/bin/apt-get", "install", "-y", "--no-install-recommends", "apparmor-profiles",
    ]);
    expect(buildPackageArgv([], apt)).toBeNull();
    expect(buildPackageArgv(["x"], null)).toBeNull();
  });
});

/**
 * 非主流发行版的手工命令（用户 2026-09-15：只给一句"请用你的包管理器安装…"等于没给）。
 * 纪律与包名白名单同源：**逐个核过才写**——所以这里只钉 NixOS 这一家的形态。
 */
describe("非主流发行版的手工命令", () => {
  it("NixOS 给可整块复制的单行命令（属性名在 nixpkgs 里逐个核过）", () => {
    const cmd = distroManualInstallCommand({ id: "nixos" }, ["bwrap", "socat", "rg"]);
    expect(cmd).toBe("nix profile install nixpkgs#bubblewrap nixpkgs#socat nixpkgs#ripgrep");
    expect(cmd).not.toContain("\n"); // 界面整块当代码复制，混进散文就不能用了
  });

  it("未核过包名的发行版 → 不给命令（宁缺勿猜），由界面退回包名提示", () => {
    expect(distroManualInstallCommand({ id: "someexotic" }, ["bwrap"])).toBeNull();
    expect(hasDistroManualCommand({ id: "someexotic" })).toBe(false);
    expect(hasDistroManualCommand({ id: "nixos" })).toBe(true);
  });

  it("含「不是装个包能解决」的项（userns）→ 整批不给命令", () => {
    expect(distroManualInstallCommand({ id: "nixos" }, ["bwrap", "userns"])).toBeNull();
    expect(distroManualInstallCommand({ id: "nixos" }, [])).toBeNull();
  });

  it("白名单外的任意串 id → 整批拒绝（渲染层不能借它注入包名）", () => {
    expect(distroManualInstallCommand({ id: "nixos" }, ["bwrap; rm -rf /"])).toBeNull();
  });
});

/**
 * 一键通道的门槛是「这台机器上真有 pkexec」，不是「发行版被我们认识」。
 * WSL / 精简镜像 / 没装 polkit 的桌面上 pkexec 不存在——按钮点了必失败（用户 2026-09-15 评估时抓出）。
 */
describe("Linux 环境探测：一键通道以 pkexec 存在为前提", () => {
  const probeMissing = (): ProbeOutcome => ({ status: "missing" });
  const itemsWith = async (exists: (p: string) => boolean) =>
    (await probeEnvironment({ platform: "linux", exists, probe: probeMissing })).items;

  it("有 pkexec → 给出 fix.auto（包名仍来自白名单）", async () => {
    const bwrap = (await itemsWith((p) => p === PKEXEC)).find((i) => i.id === "bwrap");
    expect(bwrap?.fix.auto).toEqual({ strategy: "pkg", packages: ["bubblewrap"] });
    expect(bwrap?.detail ?? "").not.toContain("pkexec");
  });

  it("没有 pkexec → 不给 fix.auto，并把原因写进 detail（否则按钮凭空消失，用户只会以为功能坏了）", async () => {
    const bwrap = (await itemsWith(() => false)).find((i) => i.id === "bwrap");
    expect(bwrap?.fix.auto).toBeUndefined();
    expect(bwrap?.detail).toContain("pkexec");
  });
});

/**
 * 用户 2026-09-15 在 Windows 上实测：界面给的手动命令跑不起来
 * （`npx --no-install @anthropic-ai/sandbox-runtime windows-install` →
 *  npm 11 `canceled due to missing packages and no YES option`）。
 * 这几条把"能整块复制到终端跑"的形态钉住。
 */
describe("Windows 手动安装命令", () => {
  it("作用域包名 + 钉版本 + --yes，且是单行（界面整块当代码复制）", () => {
    const cmd = windowsInstallCommand("0.0.75");
    expect(cmd).toBe("npx --yes @anthropic-ai/sandbox-runtime@0.0.75 windows-install");
    expect(cmd).not.toContain("\n");            // 混进散文后，复制到终端第一行就不是命令
    expect(cmd).not.toContain("--no-install");  // npm 11 译为 `--yes false`，必失败（用户实测形态）
  });

  it("读不到包内版本时退化为 latest —— 但仍必须是作用域名", () => {
    const cmd = windowsInstallCommand();
    expect(cmd).toBe("npx --yes @anthropic-ai/sandbox-runtime windows-install");
    expect(cmd).not.toContain("sandbox-runtime@");
    // 非作用域的 `sandbox-runtime` 在 npm 上是别人的「Empty package」（维护者与本项目无关）——
    // 照那种写法跑等于把陌生人的代码拉下来执行，故用正则钉住"必须带作用域前缀"
    expect(cmd).not.toMatch(/npx\s+(--\S+\s+)*sandbox-runtime\s/);
  });
});

/**
 * Windows 分支的回归测试（本次真病的钉子）：srt 的 status / install 接口**必须传 `srtWin`**，
 * 不传会抛 `no srt-win path configured` —— 那会让环境检测恒失败、一键安装恒失败，
 * 而界面只看到"检测失败 + 兜底命令"（用户 2026-09-15 报的就是这个形态）。
 */
describe("Windows 环境探测（平台注入 + srt 打桩）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
    srtHarness.calls.length = 0;
  });

  /** 造出"包内 srt"的目录形状：`<root>/vendor/srt-win/x64/srt-win.exe` + 包根 package.json */
  function packagedSrtFixture(version: string): string {
    const root = mkdtempSync(path.join(os.tmpdir(), "em-srt-"));
    dirs.push(root);
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
    mkdirSync(path.join(root, "vendor", "srt-win", "x64"), { recursive: true });
    return path.join(root, "vendor", "srt-win", "x64", "srt-win.exe");
  }

  it("状态探测带上 srtWin；手动命令是单行、钉住包内版本", async () => {
    srtHarness.exe = packagedSrtFixture("9.9.9");

    const report = await probeEnvironment({ platform: "win32" });
    const item = report.items.find((i) => i.id === "winSandbox");

    // ① 调用形态（漏传 srtWin 时这里会变成 [{}]，真机上则直接抛）
    expect(srtHarness.calls).toEqual([{ srtWin: { exe: srtHarness.exe, prependArgs: ["--srt-win"] } }]);
    // ② 结论与指引
    expect(item?.status).toBe("missing");
    expect(item?.detail).toContain("隔离账户未就绪");
    expect(item?.fix.auto).toEqual({ strategy: "winInstall" });
    expect(item?.fix.manual?.command).toBe("npx --yes @anthropic-ai/sandbox-runtime@9.9.9 windows-install");
  });
});


describe("Windows portable command runtime", () => {
  it.each(["ready", "missing", "broken"] as const)("reports actual runtime state %s with an offline repair action", async status => {
    const runtimeProbe = vi.fn(async () => ({ status, detail: "runtime check", version: "git version fixture" }));
    const report = await probeEnvironment({ platform: "win32", runtimeProbe });
    const runtime = report.items.find(item => item.id === "windowsRuntime");
    expect(runtimeProbe).toHaveBeenCalledOnce();
    expect(runtime?.required).toBe(true);
    expect(runtime?.status).toBe(status === "ready" ? "ok" : status === "missing" ? "missing" : "unknown");
    expect(runtime?.fix.auto).toEqual(status === "ready" ? undefined : { strategy: "windowsRuntime" });
    expect(report.items.some(item => item.id === "gitBash")).toBe(false);
    expect(report.items.find(item => item.id === "winSandbox")?.required).toBe(false);
  });
});

describe("Linux full isolation chain reporting", () => {
  it("does not report ready when binary versions pass but namespace/helper execution fails", async () => {
    const args: string[][] = [];
    const report = await probeEnvironment({ platform: "linux", exists: () => false,
      probe: spec => {
        if (spec.id === "userns") { args.push(spec.args); return { status: "unknown" }; }
        return { status: "ok", version: "fixture" };
      },
    });
    expect(args[0]).toContain("--unshare-net");
    expect(args[0]).toContain("--cap-drop");
    expect(args[0]?.join(" ")).toContain("apply-seccomp");
    const userns = report.items.find(item => item.id === "userns");
    expect(userns?.status).toBe("blocked");
    expect(userns?.detail).toContain("不保证完整链路可用");
  });
});
