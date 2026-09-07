import { describe, it, expect } from "vitest";
import { isChainWithinCwd, extractPathsFromCommand } from "./permission/permission-rules";

const cwd = "/Users/amon/dev/project/EasyMint";

describe("heredoc 路径提取", () => {
  it("heredoc 正文的敏感字符串不参与路径提取", () => {
    const cmd = "cat > temp/x.txt <<EOF\nmention /etc/hosts and ~/Desktop stuff\nEOF";
    const paths = extractPathsFromCommand(cmd);
    expect(paths).not.toContain("/etc/hosts");
    expect(paths).not.toContain("~/Desktop");
    expect(paths).toContain("temp/x.txt");
  });
});

describe("链式命令段级判定", () => {
  it("项目内合法链放行: cd + npm run lint", () => {
    expect(isChainWithinCwd("cd /Users/amon/dev/project/EasyMint && npm run lint", cwd).ok).toBe(true);
  });
  it("mkdir && touch 项目内放行", () => {
    expect(isChainWithinCwd("mkdir -p temp/x && touch temp/x/a.txt", cwd).ok).toBe(true);
  });
  it("链中间写工作区外 → 拒", () => {
    expect(isChainWithinCwd("cd temp && rm -rf /Users/amon/Desktop/evil", cwd).ok).toBe(false);
  });
  it("链中间 sudo → 拒", () => {
    expect(isChainWithinCwd("cd temp && sudo rm /etc/hosts", cwd).ok).toBe(false);
  });
  it("只读管道段通过", () => {
    expect(isChainWithinCwd("cat package.json | head -20", cwd).ok).toBe(true);
  });
  it("git 链通过", () => {
    expect(isChainWithinCwd("cd temp && git status && git log --oneline -5", cwd).ok).toBe(true);
  });
  it("重定向写 cwd 外 → 拒", () => {
    expect(isChainWithinCwd("echo x > /Users/amon/Desktop/out.txt", cwd).ok).toBe(false);
  });
  it("重定向写 cwd 内 → 放行", () => {
    expect(isChainWithinCwd("echo x > temp/out.txt", cwd).ok).toBe(true);
  });
  it("cd 到用户目录后 rm 相对路径 → 拒(cd 逃逸)", () => {
    expect(isChainWithinCwd("cd ~/Desktop && rm evil.txt", cwd).ok).toBe(false);
  });
  it("cd 无参/回 home 后写 → 拒", () => {
    expect(isChainWithinCwd("cd && touch x.txt", cwd).ok).toBe(false);
    expect(isChainWithinCwd("cd ~ && rm a.txt", cwd).ok).toBe(false);
  });
  it("cd 到项目外后只读 → 放行(读项目外允许)", () => {
    expect(isChainWithinCwd("cd ~/Downloads && ls", cwd).ok).toBe(true);
    expect(isChainWithinCwd("cd /Users/amon/Downloads && cat a.txt | head -5", cwd).ok).toBe(true);
  });
  it("cd 到项目外后写相对路径 → 拒", () => {
    expect(isChainWithinCwd("cd ~/Downloads && touch new.txt", cwd).ok).toBe(false);
    expect(isChainWithinCwd("cd ~/Downloads && echo hi > o.txt", cwd).ok).toBe(false);
  });
  it("cd 到项目子目录后写 → 放行", () => {
    expect(isChainWithinCwd("cd temp/drafts && touch probe.txt", cwd).ok).toBe(true);
  });
  it("2>/dev/null 丢弃重定向不误拦", () => {
    expect(isChainWithinCwd("grep x package.json 2>/dev/null && ls temp", cwd).ok).toBe(true);
  });
  it("tee 落盘 cwd 内放行", () => {
    expect(isChainWithinCwd("echo hi | tee temp/log.txt", cwd).ok).toBe(true);
  });
});
