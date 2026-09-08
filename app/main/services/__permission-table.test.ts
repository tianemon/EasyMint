/**
 * 权限判定回归表（2026-09-08 放宽命令名单后）。
 * 边界：非破坏性操作放行；删除/移动/发布等不可逆操作与系统级变更拦截。
 */
import { describe, it, expect } from "vitest";
import { isDangerousCommand } from "./permission/permission-rules";
import { isSystemMutationCommand } from "./permission/agent-permission-service";

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
