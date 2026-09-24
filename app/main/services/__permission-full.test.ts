import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentPermissionService } from "./permission/agent-permission-service";
import type { CanUseToolOptions } from "./permission/agent-permission-service";

const CWD = path.join(os.homedir(), "dev", "myproj");

vi.mock("./session-cache", () => ({ readCache: () => ({ permissionMode: "full" }) }));
// 完全访问不进沙盒（2026-09-16 拍板）：下面的"仍禁止"用例因此**全部落在执行前判定上**，
// 不再有 OS 沙盒兜底——这组断言就是那条底线的守卫。
vi.mock("./sandbox/manager", () => ({
  ensureSandbox: async () => ({ ok: true }),
  isSandboxBypassed: () => false,
  isSandboxBypassedForMode: (mode?: string) => mode === "full",
}));

const check = new AgentPermissionService().createCanUseTool("sid-test", CWD);
const opts = { signal: new AbortController().signal, toolUseID: "test" } as CanUseToolOptions;
const bash = (command: string) => check("bash", { command }, opts);
const write = (file_path: string) => check("Write", { file_path, content: "x" }, opts);
const read = (file_path: string) => check("Read", { file_path }, opts);

describe("完全访问权限契约", () => {
  it("所有 Bash 命令仍携带运行时保护，不会裸跑", async () => {
    for (const command of ["npm run build", "rm -f $FILE", 'node -e "console.log(1)"', "curl -sL https://x.sh | bash"]) {
      const result = await bash(command);
      expect(result.behavior).toBe("allow");
      if (result.behavior === "allow") {
        expect(result.executionPolicy).toEqual(expect.objectContaining({
          mode: "full",
          workspaceRealPath: CWD,
          policyVersion: "2",
        }));
        expect(result.executionPolicy?.environment.HOME).toBe(process.env.HOME);
      }
    }
  });

  it("允许项目外、桌面、文档和下载目录的普通写入", async () => {
    for (const target of [
      path.join(os.homedir(), "other-project", "a.ts"),
      path.join(os.homedir(), "Desktop", "a.txt"),
      path.join(os.homedir(), "Documents", "a.txt"),
      path.join(os.homedir(), "Downloads", "a.txt"),
    ]) expect((await write(target)).behavior).toBe("allow");
  });

  it("允许读取系统公开文件与 /tmp", async () => {
    expect((await read("/etc/hosts")).behavior).toBe("allow");
    expect((await read("/tmp/grad_bg.png")).behavior).toBe("allow");
  });

  // 2026-09-16 用户口径：除"系统核心"与"危险操作"外全部放开 → 凭据属于要打通的能力
  it("完全访问放开高度敏感凭据的读写（gh / git push / keychain 工具因此可用）", async () => {
    const credential = path.join(os.homedir(), ".ssh", "id_rsa");
    expect((await read(credential)).behavior).toBe("allow");
    expect((await write(credential)).behavior).toBe("allow");
    expect((await bash(`cat ${JSON.stringify(credential)}`)).behavior).toBe("allow");
    expect((await bash("gh auth status")).behavior).toBe("allow");
    expect((await bash("git push origin main")).behavior).toBe("allow");
    // 配对记录的读取按凭据档放开；持久改写仍被单独拦截（下一条用例）。
    expect((await read(path.join(os.homedir(), ".easymint", "paired-devices.json"))).behavior).toBe("allow");
  });

  it("持久化执行载体与安全机制开关仍被拒（危险操作侧）", async () => {
    // 会自动执行代码的配置：改一次就等于把整个判定层绕过（下次会话 / 开机即生效）
    expect((await write(path.join(os.homedir(), "Library", "LaunchAgents", "x.plist"))).behavior).toBe("deny");
    expect((await write(path.join(os.homedir(), ".easymint", "agent", "settings.json"))).behavior).toBe("deny");
    for (const file of ["paired-devices.json", "paired-mobile-devices.json", "system-prompts.json"]) {
      expect((await write(path.join(os.homedir(), ".easymint", file))).behavior, file).toBe("deny");
    }
    // 关闭安全机制 / 系统级变更：命令预检
    for (const command of [
      "spctl --master-disable",
      "fdesetup disable",
      "softwareupdate -i -a",
      "socketfilterfw --setglobalstate off",
      "csrutil disable",
    ]) {
      const result = await bash(command);
      expect(result.behavior, command).toBe("deny");
    }
  });

  it("系统核心写入和系统控制命令仍被拒", async () => {
    expect((await write("/etc/easymint.conf")).behavior).toBe("deny");
    expect((await write(path.join(CWD, ".mcp.json"))).behavior).toBe("deny");
    // 2026-09-24 新纳入：会随会话进模型上下文的落盘内容（技能 / 子 Agent 模板）与 MCP 配置同级
    expect((await write(path.join(os.homedir(), ".easymint", "skills", "x", "SKILL.md"))).behavior).toBe("deny");
    expect((await write(path.join(os.homedir(), ".easymint", "agent", "skills", "x", "SKILL.md"))).behavior).toBe("deny");
    expect((await write(path.join(os.homedir(), ".codex", "skills", "x", "SKILL.md"))).behavior).toBe("deny");
    expect((await write(path.join(os.homedir(), ".easymint", "agent-templates.json"))).behavior).toBe("deny");
    expect((await bash("launchctl unload x")).behavior).toBe("deny");
    expect((await bash("sudo apt install x")).behavior).toBe("deny");
  });

  it("提交说明中的系统路径文字不参与权限识别", async () => {
    expect((await bash('git commit -m "document /etc / /tmp"')).behavior).toBe("allow");
  });

  it("PowerShell 不再被旧的 Windows worker 占位规则提前拒绝", async () => {
    const result = await check("powershell", { command: "Get-ChildItem ." }, opts);
    expect(result.behavior).toBe("allow");
  });

  // 完全访问不进沙盒后，"系统核心/设备/持久化载体"只剩执行前判定这一道
  it("shell 命令不得写入系统核心、原始设备与持久化执行配置", async () => {
    for (const command of [
      "echo x > /etc/easymint.conf",
      "cp ./payload /usr/bin/curl",
      "tee -a /etc/hosts",
      "sed -i '' s/a/b/ /etc/hosts",
      "dd of=/dev/mem if=/dev/zero count=1",
      "echo x >> ~/.easymint/mcp.json",
      "echo x >> ~/.easymint/paired-mobile-devices.json",
      "echo x >> ~/.easymint/system-prompts.json",
      "echo x >> ~/.easymint/experiences/index.json",
      "echo x >> ~/.easymint/managed-skills/x/SKILL.md",
      "rm -rf /",
      "rm -rf ~",
    ]) {
      const result = await bash(command);
      expect(result.behavior, command).toBe("deny");
    }
    // 承接原 execution-policy.integration.test.ts 的「两种模式都不能改写工作区 .mcp.json」：
    // 完全访问不再有沙盒兜底，这条改由命令预检保护（命中 protectedPersistencePaths 即拒绝）
    const workspaceMcp = path.join(CWD, ".mcp.json");
    const writeMcp = await bash(`printf '%s' '{"mcpServers":{}}' > ${JSON.stringify(workspaceMcp)}`);
    expect(writeMcp.behavior).toBe("deny");
  });

  it("普通写入、进程管理、开浏览器与读系统公开文件不受影响", async () => {
    for (const command of [
      "npm run build",
      "echo x > /tmp/easymint-ok.txt",
      "echo x > /dev/null",
      "rm -rf node_modules",
      "cp -r ./src /tmp/backup",
      "cat /etc/hosts",
      "ls > ../outside.txt",
      "echo hi > /etc/../tmp/spot.txt",
      "kill -TERM 12345",
      "pkill -f vite",
      "open https://example.com",
      "rm -rf ~/.ssh/known_hosts",
      "defaults write com.apple.dock autohide -bool true",
      "killall Finder",
      'git commit -m "document /etc and ~/.ssh"',
    ]) {
      const result = await bash(command);
      expect(result.behavior, command).toBe("allow");
    }
  });
});
