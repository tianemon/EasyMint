import { describe, it, expect } from "vitest";
import { isChainWithinCwd, isReadOnlyPipeline, isSafeBashCommand, isDangerousCommand } from "./permission/permission-rules";

const cwd = "/Users/amon/dev/project/EasyMint";

describe("设计初衷对照: 标准模式=工作区内读写+项目外只读+禁区全拦", () => {
  // 只读项目外普通位置 → 应放行(初衷:可读项目外)
  it("cd 项目外子目录纯读(白名单命令) → 放行", () => {
    expect(isReadOnlyPipeline("cd ~/Downloads && ls")).toBe(true);
    expect(isReadOnlyPipeline("cd /Users/amon/Downloads && head -5 a.txt")).toBe(true);
  });
  // 单命令 cat 读项目外:无结构无链,服务层兜底放行(不在此函数判定)
  it("cat 不在只读白名单(设计保守)——但单命令由服务层兜底,此处仅验证非危险", () => {
    expect(isDangerousCommand("cat /Users/amon/Downloads/a.txt")).toBe(false);
    expect(isSafeBashCommand("cat /Users/amon/Downloads/a.txt")).toBe(false); // cat 有意不在白名单
  });
  // 写项目内任意路径 → 放行
  it("tee/cp/mkdir 项目内 → 放行", () => {
    expect(isChainWithinCwd("tee temp/a.txt < package.json", cwd).ok).toBe(true);
    expect(isChainWithinCwd("cp package.json temp/b.json && ls temp", cwd).ok).toBe(true);
  });
  // 禁区不因链式放宽: 系统/凭据/用户目录在链中
  it("链中写系统核心 → 拒", () => {
    expect(isChainWithinCwd("echo x > /etc/hosts && ls", cwd).ok).toBe(false);
  });
  it("链中 ~/.ssh 路径 → 拒(整串禁区先行,链内也覆盖)", () => {
    expect(isChainWithinCwd("cp ~/.ssh/id_rsa temp/ && ls", cwd).ok).toBe(false);
  });
  // 变量展开 → 沙盒域(不落链式放行);rm 恒危险不受变量影响
  it("变量展开命令中 rm 仍拒(危险命令优先)", () => {
    expect(isChainWithinCwd("cd temp && rm $FILE", cwd).ok).toBe(false);
  });
  it("变量展开 + 非危险写段 → 服务层沙盒域(此层不崩即可)", () => {
    expect(isChainWithinCwd("cd temp && touch $FILE", cwd).ok).toBe(true); // 服务层会先沙盒,此层仅不崩
  });
});
