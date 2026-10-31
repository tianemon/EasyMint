import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { fixUserns, installDependencies, isWindowsInstallRequest, outputTail, type InstallEvent } from "./run";
import type { EnvItem, EnvReport } from "./types";

/** 假子进程：close 在下一个微任务里触发，模拟 spawn→退出 */
function fakeChild(code: number | null) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter; stderr: EventEmitter; kill: (s?: string) => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setTimeout(() => { child.stdout.emit("data", "installing…\n"); child.emit("close", code); }, 0);
  return child;
}

const report = (status: EnvItem["status"][], ids: EnvItem["id"][]): EnvReport => ({
  items: ids.map((id, i) => ({ id, label: id, required: true, status: status[i]!, fix: {} })),
  distro: { id: "ubuntu", autoInstallable: true },
  probedAt: 0,
});

const run = (opts: {
  code?: number | null;
  before?: EnvItem["status"][];
  after?: EnvItem["status"][];
  plan?: { strategy: "pkg"; argv: string[] | null; manualCommand?: string };
  signal?: AbortSignal;
}) => {
  const events: InstallEvent[] = [];
  const spawnFn = vi.fn(() => fakeChild(opts.code ?? 0));
  return {
    events,
    spawnFn,
    promise: installDependencies(
      ["bwrap", "socat", "rg"],
      (e) => events.push(e),
      {
        spawn: spawnFn as never,
        probe: async () => report(opts.after ?? ["ok", "ok", "ok"], ["bwrap", "socat", "rg"]),
        logger: () => { /* 单测不写日志文件 */ },
        plan: opts.plan ?? { strategy: "pkg", argv: ["/usr/bin/pkexec", "/usr/bin/apt-get", "install", "-y", "bubblewrap"] },
      },
      opts.signal,
    ),
  };
};

describe("依赖安装执行层", () => {
  it("成功：事件按 准备→安装→复核→完成 顺序，且不重复", async () => {
    const { events, promise } = run({ code: 0 });
    const res = await promise;
    expect(res.ok).toBe(true);
    expect(events.map((e) => e.phase)).toEqual(["preparing", "installing", "verifying", "done"]);
  });

  it("命令失败：报退出码 + 给自助命令，并带上复核结果", async () => {
    const { promise } = run({ code: 100, after: ["missing", "ok", "ok"], plan: { strategy: "pkg", argv: ["/usr/bin/pkexec", "/x"], manualCommand: "sudo apt install bubblewrap" } });
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(100);
    expect(res.reason).toContain("100");
    expect(res.manualCommand).toBe("sudo apt install bubblewrap");
  });

  it("命令成功但组件仍不可用（多为系统策略拦截）：不说“安装失败”，而是说清仍不可用", async () => {
    const { promise } = run({ code: 0, after: ["blocked", "ok", "ok"] });
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("bwrap");
    expect(res.reason).toContain("系统策略");
  });

  it("没有可用安装通道：不 spawn，直接给自助命令（不猜命令）", async () => {
    const { promise, spawnFn } = run({ plan: { strategy: "pkg", argv: null, manualCommand: "sudo pacman -S bubblewrap" } });
    const res = await promise;
    expect(spawnFn).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.manualCommand).toBe("sudo pacman -S bubblewrap");
  });

  it("取消：终止子进程并把原因标为已取消", async () => {
    const ac = new AbortController();
    ac.abort();
    const { promise, spawnFn } = run({ code: null, after: ["missing", "missing", "missing"], signal: ac.signal });
    const res = await promise;
    const child = spawnFn.mock.results[0]!.value as { kill: ReturnType<typeof vi.fn> };
    expect(child.kill).toHaveBeenCalled();
    expect(res.reason).toBe("安装已取消");
  });

  it("Windows：用户关掉 UAC 弹窗 → 说成「你点了取消」，不冒充安装失败", async () => {
    // srt 的 installWindowsSandboxAsync 在用户取消时**不抛异常**，而是返回 {cancelled:true}（exit 10）。
    // 此前这个返回值被丢掉 → 复核后发现没装上 → 界面显示「安装未完成（退出码 null：…网络/镜像源不可达）」，
    // 把用户自己的选择说成了故障（用户 2026-09-15 评估时抓出来的）。
    const events: InstallEvent[] = [];
    const res = await installDependencies(
      ["winSandbox"],
      (e) => events.push(e),
      {
        plan: { strategy: "winInstall" },
        installWin: async () => ({ cancelled: true }),
        logger: () => {},
        probe: async () => report(["missing"], ["winSandbox"]),
      },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("取消");
    // 断言要钉住"不再套用通用文案"：那两串只在 Linux/pkexec 的兜底分支里出现
    expect(res.reason).not.toContain("null");
    expect(res.reason).not.toContain("镜像源");
  });

  it("只复核本次请求：Windows 可选 Git Bash 缺失不把 winSandbox 安装判成失败", async () => {
    const events: InstallEvent[] = [];
    const res = await installDependencies(
      ["winSandbox"],
      (e) => events.push(e),
      {
        plan: { strategy: "winInstall" },
        installWin: async () => ({ cancelled: false }),
        logger: () => {},
        probe: async () => ({
          items: [
            { id: "winSandbox", label: "sandbox", required: true, status: "ok", fix: {} },
            { id: "gitBash", label: "git bash", required: false, status: "missing", fix: {} },
          ],
          distro: { id: "windows", autoInstallable: false },
          probedAt: 0,
        }),
      },
    );
    expect(res.ok).toBe(true);
    expect(events.at(-1)?.message).toContain("其余环境问题");
  });

  it("Windows 提权安装请求只接受唯一的 winSandbox 白名单 ID", () => {
    expect(isWindowsInstallRequest(["winSandbox"])).toBe(true);
    expect(isWindowsInstallRequest(["gitBash"])).toBe(false);
    expect(isWindowsInstallRequest(["anything"])).toBe(false);
    expect(isWindowsInstallRequest(["winSandbox", "anything"])).toBe(false);
  });
});

describe("输出尾部处理", () => {
  it("剥掉终端控制字符并截断", () => {
    const raw = `\u001b[32mok\u001b[0m\n${"x".repeat(500)}`;
    const t = outputTail(raw, 10);
    expect(t).not.toContain("\u001b");
    expect(t).toHaveLength(10);
  });
});

// ── userns 放行的一键修复（执行层） ─────────────────────────────────────────────
// 本机是 macOS，故显式注入 platform: "linux" 与 exists（否则会走平台短路 / 真实文件系统）。

const USERNS_ITEM: EnvItem = {
  id: "userns", label: "隔离能力（用户命名空间）", required: true, status: "blocked", fix: {},
};
const USERNS_REPORT = (status: EnvItem["status"]): EnvReport => ({
  items: [{ ...USERNS_ITEM, status }],
  distro: { id: "ubuntu", autoInstallable: true },
  probedAt: 0,
});

const DEST = "/etc/apparmor.d/bwrap-userns-restrict";
const SRC = "/usr/share/apparmor/extra-profiles/bwrap-userns-restrict";

const aptInstaller = { kind: "apt", path: "/usr/bin/apt-get", args: ["install", "-y", "--no-install-recommends"] } as never;

/** 假文件系统：初始有一组路径；spawn 回调可以往里加（模拟"包装上了模板"） */
function fixRun(opts: {
  existing: string[];
  codes?: (number | null)[];
  after: EnvItem["status"];
  installer?: unknown;
  onSpawn?: (argv: string[], fs: Set<string>) => void;
  signal?: AbortSignal;
}) {
  const fs = new Set(opts.existing);
  const events: InstallEvent[] = [];
  const codes = opts.codes ?? [];
  let call = 0;
  const spawnFn = vi.fn((argv0: string, argvRest: string[]) => {
    const argv = [argv0, ...argvRest];
    const code = codes[call] === undefined ? 0 : codes[call]!; // 显式 null 要保留（= 无退出码），不能用 ?? 0 吞掉
    call += 1;
    opts.onSpawn?.(argv, fs);
    return fakeChild(code);
  });
  return {
    events,
    spawnFn,
    argvOf: (i: number) => (spawnFn.mock.calls[i] ? [spawnFn.mock.calls[i]![0], ...spawnFn.mock.calls[i]![1]] : []),
    promise: fixUserns(
      (e) => events.push(e),
      {
        platform: "linux",
        spawn: spawnFn as never,
        exists: (p) => fs.has(p),
        probe: async () => USERNS_REPORT(opts.after),
        logger: () => { /* 单测不写日志文件 */ },
        installer: (opts.installer === undefined ? aptInstaller : opts.installer) as never,
      },
      opts.signal,
    ),
  };
}

/** 一台"能一键修复"的机器的文件系统：pkexec（弹授权）+ install + apparmor_parser 都要在 */
const PKEXEC = "/usr/bin/pkexec";
const BINS = [PKEXEC, "/usr/bin/install", "/usr/sbin/apparmor_parser"];

describe("userns 一键修复：执行层", () => {
  it("模板已在：只跑 复制 + 加载 两条 pkexec 命令（都是绝对路径单命令）", async () => {
    const { promise, spawnFn, argvOf } = fixRun({ existing: [...BINS, SRC], after: "ok" });
    const res = await promise;
    expect(res.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(argvOf(0)).toEqual(["/usr/bin/pkexec", "/usr/bin/install", "-m", "0644", SRC, DEST]);
    expect(argvOf(1)).toEqual(["/usr/bin/pkexec", "/usr/sbin/apparmor_parser", "-r", DEST]);
    // 命令里不能出现 shell（否则等于把命令拼成字符串）
    expect(JSON.stringify([argvOf(0), argvOf(1)])).not.toMatch(/\/(ba)?sh\b/);
  });

  it("模板缺失：先装 apparmor-profiles，再复制与加载（装完要重新确认模板真的出现了）", async () => {
    const { promise, spawnFn, argvOf } = fixRun({
      existing: [...BINS], after: "ok",
      onSpawn: (_argv, fs) => fs.add(SRC),   // 第一次命令之后模板到位
    });
    const res = await promise;
    expect(res.ok).toBe(true);
    expect(spawnFn).toHaveBeenCalledTimes(3);
    expect(argvOf(0)).toEqual([
      "/usr/bin/pkexec", "/usr/bin/apt-get", "install", "-y", "--no-install-recommends", "apparmor-profiles",
    ]);
  });

  it("装包成功但模板仍没出现 → 不当成功，给手工指引", async () => {
    const { promise, spawnFn } = fixRun({ existing: [...BINS], after: "blocked" });
    const res = await promise;
    expect(spawnFn).toHaveBeenCalledTimes(1); // 没继续往下盲跑
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("apparmor-profiles");
    expect(res.manualCommand).toContain("sudo");
  });

  it("pkexec 退出码 126（用户关闭了授权框）→ 精确说成「取消」，并附手工指引", async () => {
    // 依据 polkit 官方手册 pkexec(1) 的 RETURN VALUE 段：126 = 用户关闭了认证对话框
    const { promise } = fixRun({ existing: [...BINS, SRC], codes: [0, 126], after: "blocked" });
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(126);
    expect(res.reason).toContain("126");
    // 断言必须用**只在专用分支里出现**的特征串：通用文案本身含"取消"二字，
    // 用 toContain("取消") 区分不出两者（曾这样写，被负向验证抓出来）
    expect(res.reason).toContain("命令没有执行");
    expect(res.reason).not.toContain("常见原因");
    expect(res.reason).not.toContain("安装失败"); // 不说成"安装失败"——那是另一回事
    expect(res.manualCommand).toContain("apparmor_parser -r");
  });

  it("pkexec 退出码 127（未获授权 / 认证无法完成）→ 与 126 区分开，不提「取消」", async () => {
    // 手册：未获授权、认证无法完成或发生错误 → 127。两位数字含义不同，不能混成一句话
    const { promise } = fixRun({ existing: [...BINS, SRC], codes: [0, 127], after: "blocked" });
    const res = await promise;
    expect(res.exitCode).toBe(127);
    expect(res.reason).toContain("127");
    expect(res.reason).toContain("授权没成功");
    expect(res.reason).not.toContain("取消");
  });

  it("其他退出码 → 不套用 pkexec 的专用解释，用通用说明", async () => {
    const { promise } = fixRun({ existing: [...BINS, SRC], codes: [0, 3], after: "blocked" });
    const res = await promise;
    expect(res.exitCode).toBe(3);
    expect(res.reason).toContain("3");
    expect(res.reason).toContain("常见原因");
    // 手册说「成功时原样返回 PROGRAM 的返回码」，即 PROGRAM 自己也可能返回 126/127；
    // 因此 126 的文案写成「通常表示」而非断言——这条断言守住那个措辞
    expect(res.reason).not.toContain("通常表示");
  });

  it("写配置就失败 → 停在那里，不继续盲跑加载命令", async () => {
    const { promise, spawnFn } = fixRun({ existing: [...BINS, SRC], codes: [1], after: "blocked" });
    const res = await promise;
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(res.reason).toContain("写入系统配置未完成");
  });

  it("命令成功但仍被挡 → 说清「未放行 + 重启」，不谎报成功", async () => {
    const { promise } = fixRun({ existing: [...BINS, SRC], after: "blocked" });
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("仍未放行");
    expect(res.report?.items[0]?.status).toBe("blocked");
  });

  it("加载失败：文件已就位，说明重启后由系统服务加载", async () => {
    const { promise } = fixRun({ existing: [...BINS, SRC], codes: [0, 1], after: "blocked" });
    const res = await promise;
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(1);
    expect(res.reason).toContain("重启");
  });

  it("profile 已在：什么都不做（幂等，不覆盖系统自带或用户改过的）", async () => {
    const { promise, spawnFn } = fixRun({ existing: [...BINS, SRC, DEST], after: "ok" });
    const res = await promise;
    expect(spawnFn).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it("没有包管理器且模板缺失 → 不 spawn，直接给自助命令", async () => {
    const { promise, spawnFn } = fixRun({ existing: [...BINS], installer: null, after: "blocked" });
    const res = await promise;
    expect(spawnFn).not.toHaveBeenCalled();
    expect(res.reason).toContain("包管理器");
    expect(res.manualCommand).toBeTruthy();
  });

  it("取消：终止子进程，并说明配置已写入", async () => {
    const ac = new AbortController();
    ac.abort();
    const { promise, spawnFn } = fixRun({ existing: [...BINS, SRC], codes: [null], after: "blocked", signal: ac.signal });
    const res = await promise;
    const child = spawnFn.mock.results[0]!.value as { kill: ReturnType<typeof vi.fn> };
    expect(child.kill).toHaveBeenCalled();
    expect(res.reason).toBe("已取消");
  });

  it("没有 pkexec（polkit 缺失的镜像）→ 不 spawn，直接给手工三步并说明原因", async () => {
    // WSL / 精简镜像 / 没装 polkit 的桌面上没有 pkexec：此前界面照样给「一键修复」，
    // 点了必然失败（而这类机器其实有 sudo，手工命令一贴就成）
    const { promise, spawnFn } = fixRun({ existing: [...BINS.filter((p) => p !== PKEXEC), SRC], after: "blocked" });
    const res = await promise;
    expect(spawnFn).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("pkexec");
    expect(res.manualCommand).toContain("apparmor_parser -r");
  });

  it("非 Linux：直接拒绝，不做任何事", async () => {
    const events: InstallEvent[] = [];
    const spawnFn = vi.fn(() => fakeChild(0));
    const res = await fixUserns((e) => events.push(e), {
      platform: "win32", spawn: spawnFn as never, logger: () => { /* noop */ },
    });
    expect(res.ok).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });
});


describe("Windows runtime preparation stays separate from sandbox elevation", () => {
  it("uses the portable preparer, forwards progress and verifies without UAC or package commands", async () => {
    const events: InstallEvent[] = [];
    const prepareRuntime = vi.fn(async ({ onProgress }: { onProgress?: (message: string) => void }) => { onProgress?.("extracting fixture"); });
    const installWin = vi.fn(); const spawn = vi.fn();
    const result = await installDependencies(["windowsRuntime"], event => events.push(event), {
      plan: { strategy: "windowsRuntime" }, prepareRuntime, installWin, spawn: spawn as never, logger: () => {},
      probe: async () => report(["ok", "missing"], ["windowsRuntime", "winSandbox"]),
    });
    expect(prepareRuntime).toHaveBeenCalledOnce();
    expect(installWin).not.toHaveBeenCalled(); expect(spawn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(events.some(event => event.message === "extracting fixture")).toBe(true);
    expect(events.at(-1)?.phase).toBe("done");
  });

  it("returns a runtime repair error locally without elevation or misleading authorization advice", async () => {
    const installWin = vi.fn();
    const result = await installDependencies(["windowsRuntime"], () => {}, {
      plan: { strategy: "windowsRuntime" }, prepareRuntime: async () => { throw new Error("archive damaged"); }, installWin, logger: () => {},
      probe: async () => report(["unknown"], ["windowsRuntime"]),
    });
    expect(result.ok).toBe(false); expect(result.reason).toContain("archive damaged");
    expect(result.reason).not.toContain("系统授权"); expect(installWin).not.toHaveBeenCalled();
  });
});


it("runtime repair remains failed when preparation returns but capability verification is not ready", async () => {
  const result = await installDependencies(["windowsRuntime"], () => {}, {
    plan: { strategy: "windowsRuntime" }, prepareRuntime: async () => {}, logger: () => {},
    probe: async () => report(["unknown"], ["windowsRuntime"]),
  });
  expect(result.ok).toBe(false);
  expect(result.reason).toContain("命令运行环境尚不可用");
});

it("forwards runtime cancellation without requesting elevation", async () => {
  const controller = new AbortController(); controller.abort();
  const installWin = vi.fn();
  const result = await installDependencies(["windowsRuntime"], () => {}, {
    plan: { strategy: "windowsRuntime" },
    prepareRuntime: async ({ signal }) => { expect(signal).toBe(controller.signal); throw new Error("cancelled"); },
    installWin, logger: () => {}, probe: async () => report(["missing"], ["windowsRuntime"]),
  }, controller.signal);
  expect(result.ok).toBe(false); expect(result.reason).toBe("安装已取消");
  expect(installWin).not.toHaveBeenCalled();
  expect(isWindowsInstallRequest(["windowsRuntime", "winSandbox"])).toBe(false);
});
