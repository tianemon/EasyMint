/**
 * 系统控制命令的提前诊断回归。
 * 文件系统安全不依赖这些文本扫描，由 execution-policy 集成测试覆盖。
 */
import { describe, it, expect } from "vitest";
import { isSystemMutationCommand } from "./permission/agent-permission-service";

describe("系统级变更命令（任何模式拒绝）", () => {
  it("系统管理/提权/磁盘类 → 拦截", () => {
    expect(isSystemMutationCommand("sudo apt install x")).toBe(true);
    expect(isSystemMutationCommand("launchctl unload ~/Library/LaunchAgents/x.plist")).toBe(true);
    expect(isSystemMutationCommand("mount /dev/disk2 /Volumes/x")).toBe(true);
    expect(isSystemMutationCommand("diskutil eraseDisk JHFS+ x /dev/disk2")).toBe(true);
    expect(isSystemMutationCommand("/usr/bin/sudo apt install x")).toBe(true);
    expect(isSystemMutationCommand("env LC_ALL=C /bin/launchctl unload x.plist")).toBe(true);
    expect(isSystemMutationCommand("reg add HKLM\\Software\\Example /v Flag /t REG_DWORD /d 1")).toBe(true);
    expect(isSystemMutationCommand("sc config Example start= auto")).toBe(true);
    expect(isSystemMutationCommand("Set-ItemProperty HKLM:\\Software\\Example Flag 1")).toBe(true);
    expect(isSystemMutationCommand("sc.exe stop Spooler")).toBe(true);
    expect(isSystemMutationCommand("reg.exe add HKCU\\Software\\Example /v Flag /d 1")).toBe(true);
    expect(isSystemMutationCommand("cmd.exe /c sc stop Spooler")).toBe(true);
    expect(isSystemMutationCommand("powershell.exe -Command Set-Service Spooler -Status Stopped")).toBe(true);
    expect(isSystemMutationCommand("pwsh -EncodedCommand AAAA")).toBe(true);
    expect(isSystemMutationCommand("schtasks.exe /Create /TN Demo /TR calc.exe")).toBe(true);
    expect(isSystemMutationCommand("Start-Service Spooler")).toBe(true);
  });
  it("普通项目命令 → 放行", () => {
    expect(isSystemMutationCommand("npm run build")).toBe(false);
    expect(isSystemMutationCommand("git status")).toBe(false);
    expect(isSystemMutationCommand("node -e \"console.log(1)\"")).toBe(false);
    expect(isSystemMutationCommand("launchctl list")).toBe(false);
    expect(isSystemMutationCommand("systemctl status docker")).toBe(false);
    expect(isSystemMutationCommand("diskutil info /")).toBe(false);
    expect(isSystemMutationCommand("mount")).toBe(false);
    expect(isSystemMutationCommand("git commit -m 'docs: launchctl unload / 说明'")).toBe(false);
    expect(isSystemMutationCommand("cat <<'EOF'\nsudo reboot\nEOF")).toBe(false);
    expect(isSystemMutationCommand("# $(sudo -n true)")).toBe(false);
    expect(isSystemMutationCommand("cat <<'EOF'\n$(sudo -n true)\nEOF")).toBe(false);
  });
  it("命令替换、反引号与未引用换行中的系统命令 → 拦截", () => {
    expect(isSystemMutationCommand('echo "$(sudo -n true)"')).toBe(true);
    expect(isSystemMutationCommand("echo `sudo -n true`")).toBe(true);
    expect(isSystemMutationCommand("echo ok\nsudo -n true")).toBe(true);
    expect(isSystemMutationCommand("cat <<EOF\n$(sudo -n true)\nEOF")).toBe(true);
  });
});
