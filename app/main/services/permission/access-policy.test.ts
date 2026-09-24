import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExecutionPolicy,
  accessPolicyInternals,
  canonicalPolicyPath,
  isWithin,
  isStandardWritableTarget,
  protectedControlPaths,
  protectedCredentialPaths,
  protectedWriteRoots,
  standardWriteRoots,
} from "./access-policy";
import { developmentRuntimeFor, developmentRuntimesRoot } from "./development-runtime";
import { emHome } from "../../utils/paths";
import type { ExecutionContext } from "./execution-context";

describe("统一资源策略", () => {
  const cwd = path.join(os.homedir(), "dev", "project");

  const context = (mode: "standard" | "full"): ExecutionContext => ({
    mode,
    workspaceRealPath: path.resolve(cwd),
    runtimeRoot: path.join(os.homedir(), ".easymint", "runtimes", "test-runtime"),
    environment: {},
    policyVersion: "2",
  });

  it("标准模式允许写入工作区、运行区与系统临时目录", () => {
    const filesystem = buildExecutionPolicy(context("standard")).filesystem!;
    expect(filesystem.allowWrite).toContain(path.resolve(cwd));
    expect(filesystem.allowWrite).toContain(context("standard").runtimeRoot);
    // 系统临时目录（2026-09-17 新增）：写 /tmp 是开发常规动作（工具链 scratch、进程间传文件），
    // 拦它属于纯误伤——Codex 官方口径同样是"工作区含 cwd 与 /tmp 等临时目录"。
    if (process.platform !== "win32") {
      expect(filesystem.allowWrite).toContain("/tmp");
      expect(filesystem.allowWrite).toContain("/var/tmp");
    }
    // 平台注入断言：不依赖宿主是哪台机器，两个平台的临时目录口径都要钉住
    // （2026-09-17 补：原负样本用的是 `os.tmpdir()` —— macOS 上它是 /var/folders/…、不在表里所以本地绿，
    //  Linux 上它就是 `/tmp` **正在白名单里** ⇒ 同一句在 CI 必红。**负样本一律不得平台耦合**，
    //  涉及 platform 的判定按纪律参数注入。）
    expect(standardWriteRoots(cwd, context("standard").runtimeRoot, "linux")).toEqual(
      expect.arrayContaining(["/tmp", "/var/tmp", "/private/tmp", "/private/var/tmp"]),
    );
    expect(standardWriteRoots(cwd, context("standard").runtimeRoot, "win32")).toEqual(
      expect.arrayContaining([cwd, context("standard").runtimeRoot]),
    );
    // 但不能顺手放开宿主其它目录
    expect(filesystem.allowWrite).not.toContain(path.join(os.homedir(), "Documents"));
    expect(filesystem.allowWrite).not.toContain(path.resolve("/var"));
    expect(filesystem.allowWrite).not.toContain(path.join(os.homedir(), ".npm"));
    expect(filesystem.denyRead).toContain(developmentRuntimesRoot());
    expect(filesystem.allowRead).toContain(context("standard").runtimeRoot);
  });

  // 甲-3：判定层的「区外写」与沙盒的 allowWrite 必须同源，否则同一个 /tmp 会出现两种拒绝口径。
  // （注意 isStandardWritableTarget 自己按 developmentRuntimeFor 推导运行区——真实运行时
  //   createExecutionContext 用的是同一个函数，所以两者一致；测试里的自定义 runtimeRoot 不参与此断言。）
  it("判定层与沙盒对同一个目标给出一致口径", () => {
    expect(isStandardWritableTarget(path.resolve(cwd), path.resolve(cwd, "src", "a.ts"))).toBe(true);
    expect(isStandardWritableTarget(path.resolve(cwd), "/tmp/em-scratch.txt")).toBe(process.platform !== "win32");
    expect(isStandardWritableTarget(path.resolve(cwd), path.join(os.homedir(), "Desktop", "a.txt"))).toBe(false);
  });

  it("完全访问扩大 allowWrite，但保留相同核心 deny", () => {
    const standard = buildExecutionPolicy(context("standard")).filesystem!;
    const full = buildExecutionPolicy(context("full")).filesystem!;
    expect(full.allowWrite).toContain(process.platform === "win32" ? path.parse(os.homedir()).root : "/");
    expect(standard.denyWrite).toEqual(expect.arrayContaining(full.denyWrite ?? []));
    expect(standard.denyWrite).toContain(path.join(os.homedir(), ".npm", "_logs"));
    expect(full.denyRead).toEqual(protectedCredentialPaths());
  });

  it("Windows 完全访问始终包含当前工作区所在卷", () => {
    expect(accessPolicyInternals.filesystemRoots("D:\\work\\demo", "win32")).toContain("D:\\");
    expect(accessPolicyInternals.filesystemRoots("D:\\work\\demo", "win32", ["E:\\"])).toContain("E:\\");
    expect(accessPolicyInternals.windowsVolumeMetadataPaths(["D:\\", "E:\\"], "win32"))
      .toEqual(expect.arrayContaining(["D:\\System Volume Information", "D:\\$Recycle.Bin", "E:\\System Volume Information"]));
  });

  it("/tmp 和用户文档不属于核心写保护", () => {
    const protectedRoots = protectedWriteRoots();
    expect(protectedRoots).not.toContain("/tmp");
    expect(protectedRoots).not.toContain(path.join(os.homedir(), "Desktop"));
  });

  it("凭据读写保护独立于普通用户目录", () => {
    const credentials = protectedCredentialPaths();
    expect(credentials).toContain(path.join(os.homedir(), ".ssh"));
    expect(credentials).not.toContain(path.join(os.homedir(), "Documents"));
    expect(credentials).toContain(path.join(emHome(), "em-settings.json"));
    expect(credentials).toContain(path.join(emHome(), ".control-tmp"));
    expect(credentials).toContain(path.join(os.homedir(), ".zshrc"));
    expect(credentials).toContain(path.join(os.homedir(), ".curlrc"));
    expect(credentials).toContain(path.join(os.homedir(), ".wgetrc"));
  });

  it("EasyMint 权限状态与可执行配置属于写保护控制面", () => {
    const controls = protectedControlPaths(cwd);
    expect(controls).toContain(path.join(os.homedir(), ".easymint", "session-cache"));
    expect(controls).toContain(path.join(cwd, ".easymint", "mcp.json"));
    expect(controls).toContain(path.join(cwd, ".mcp.json"));
    // MCP server 自述缓存：其内容会进工具说明与搜索结果，必须和 mcp.json 同级保护——
    // 否则完全访问档下可被改写，变成绕开审批门的持久化提示词注入
    expect(controls).toContain(path.join(os.homedir(), ".easymint", "mcp-instructions.json"));
    expect(controls).not.toContain(path.join(os.homedir(), ".easymint", "skills"));
    expect(protectedControlPaths(cwd, "win32")).toContain(path.win32.join(
      process.env.APPDATA || path.win32.join(os.homedir(), "AppData", "Roaming"),
      "Microsoft", "Windows", "Start Menu", "Programs", "Startup",
    ));
  });

  it("路径包含关系在折叠 .. 后判定", () => {
    const root = canonicalPolicyPath(cwd, cwd);
    expect(isWithin(root, canonicalPolicyPath(path.join(cwd, "src", "a.ts"), cwd))).toBe(true);
    expect(isWithin(root, canonicalPolicyPath(path.join(cwd, "..", "outside.ts"), cwd))).toBe(false);
  });

  it("标准模式的显式文件工具只可写工作区和本项目运行区", () => {
    expect(isStandardWritableTarget(cwd, path.join(cwd, "src", "a.ts"))).toBe(true);
    expect(isStandardWritableTarget(cwd, path.join(developmentRuntimeFor(cwd).root, "cache", "x"))).toBe(true);
    expect(isStandardWritableTarget(cwd, path.join(developmentRuntimesRoot(), "other-runtime", "x"))).toBe(false);
  });
});
