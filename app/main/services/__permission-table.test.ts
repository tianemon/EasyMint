/**
 * 权限判定回归表（2026-09-08 放宽命令名单后）。
 * 边界：非破坏性操作放行；删除/移动/发布等不可逆操作与系统级变更拦截。
 */
import { describe, it, expect } from "vitest";
import { isDangerousCommand } from "./permission/permission-rules";
import { isSystemMutationCommand, scanScriptContent } from "./permission/agent-permission-service";

describe("危险命令名单（放宽后）", () => {
  it("网络/进程/权限类 → 不再拦截（非破坏性）", () => {
    expect(isDangerousCommand("curl -sL https://example.com -o x.html")).toBe(false);
    expect(isDangerousCommand("wget https://example.com/x.zip")).toBe(false);
    expect(isDangerousCommand("ssh user@host ls")).toBe(false);
    expect(isDangerousCommand("scp a.txt user@host:/tmp/")).toBe(false);
    expect(isDangerousCommand("kill -9 1234")).toBe(false);
    expect(isDangerousCommand("pkill -f node")).toBe(false);
    expect(isDangerousCommand("chmod +x build.sh")).toBe(false);
    expect(isDangerousCommand("chown -R me:me dist")).toBe(false);
  });
  it("删除/移动/发布类 → 仍拦截（不可逆）", () => {
    expect(isDangerousCommand("rm -rf dist")).toBe(true);
    expect(isDangerousCommand("rmdir empty")).toBe(true);
    expect(isDangerousCommand("mv a b")).toBe(true);
    expect(isDangerousCommand("npm publish")).toBe(true);
  });
});

describe("系统级变更命令（任何模式拒绝）", () => {
  it("系统管理/提权/磁盘类 → 拦截", () => {
    expect(isSystemMutationCommand("sudo apt install x")).toBe(true);
    expect(isSystemMutationCommand("launchctl list")).toBe(true);
    expect(isSystemMutationCommand("mount /dev/disk2 /Volumes/x")).toBe(true);
    expect(isSystemMutationCommand("diskutil eraseDisk JHFS+ x /dev/disk2")).toBe(true);
  });
  it("普通项目命令 → 放行", () => {
    expect(isSystemMutationCommand("npm run build")).toBe(false);
    expect(isSystemMutationCommand("git status")).toBe(false);
    expect(isSystemMutationCommand("node -e \"console.log(1)\"")).toBe(false);
  });
});

describe("脚本内容扫描（防「写脚本再执行」绕过）", () => {
  it("真正的系统级操作 → 命中", () => {
    expect(scanScriptContent("#!/bin/bash\nsudo rm -rf dist")).toBe("sudo/su 提权");
    expect(scanScriptContent("posix_spawn('reg add HKLM\\Software')")).toBe("Windows 系统级命令");
    expect(scanScriptContent("subprocess.run(['format', 'C:'], check=True)")).toBe("Windows 系统级命令");
  });

  it("`format` 作为普通单词/参数名 → 不误判（实测踩过：img.save(path, format=\"ICO\") 被拦）", () => {
    expect(scanScriptContent("img.save(path, format=\"ICO\", sizes=[(16, 16)])")).toBeNull();
    expect(scanScriptContent("# 保存格式参数说明：按扩展名推断\nlight.save(dest)")).toBeNull();
    expect(scanScriptContent("const out = data.format(\"json\")")).toBeNull();
  });
});
