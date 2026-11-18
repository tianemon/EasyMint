import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRT_SANDBOX_DIR = path.join(process.cwd(), "node_modules", "@anthropic-ai", "sandbox-runtime", "dist", "sandbox");
const LINUX_FILE = path.join(SRT_SANDBOX_DIR, "linux-sandbox-utils.js");
const MAC_FILE = path.join(SRT_SANDBOX_DIR, "macos-sandbox-utils.js");

/** 抽出 dist 里的 isWithinAnyAllowedWritePath 并编译成可调用的判定 */
function compileIsWithinAllowedWrite(allowedWritePaths: string[]): (candidate: string) => boolean {
  const source = fs.readFileSync(LINUX_FILE, "utf-8");
  const matched = source.match(/const isWithinAnyAllowedWritePath = ([\s\S]*?);\n/);
  if (!matched) throw new Error("dist 里找不到 isWithinAnyAllowedWritePath（上游结构变化？）");
  const shared = fs.readFileSync(path.join(SRT_SANDBOX_DIR, "sandbox-utils.js"), "utf-8");
  const helper = shared.match(/export (function isAtOrUnder\([^\n]+\) \{[\s\S]*?\n\})/);
  if (!helper) throw new Error("上游的根路径判定结构已变化");
  const factory = new Function("allowedWritePaths", `${helper[1]}\nreturn ${matched[1]};`) as (a: string[]) => (c: string) => boolean;
  return factory(allowedWritePaths);
}

describe("sandbox-runtime 补丁", () => {
  it("上游根路径 allowWrite 覆盖绝对路径", () => {
    const within = compileIsWithinAllowedWrite(["/"]);
    expect(within("/home/u/.easymint/mcp.json")).toBe(true);
    expect(within("/etc/passwd")).toBe(true);
    expect(within("/")).toBe(true);
  });

  it("修复未改变具体目录的语义（标准模式那一侧不能被带坏）", () => {
    const within = compileIsWithinAllowedWrite(["/workspace", path.join(os.tmpdir(), "rt")]);
    expect(within("/workspace/a/b")).toBe(true);
    expect(within("/workspace")).toBe(true);
    expect(within(path.join(os.tmpdir(), "rt", "home"))).toBe(true);
    expect(within("/etc/passwd")).toBe(false);
    // 前缀相似但不是子路径：不能误判为"在内"
    expect(within("/workspacex/a")).toBe(false);
  });

  it("mandatory deny 的补丁仍在（可执行配置的保护不能被连带丢掉）", () => {
    const linux = fs.readFileSync(LINUX_FILE, "utf-8");
    const mac = fs.readFileSync(MAC_FILE, "utf-8");
    for (const source of [linux, mac]) {
      expect(source).toContain("// EasyMint: retain executable configuration protections.");
    }
    for (const name of [".mcp.json", ".gitconfig", ".bashrc", ".ripgreprc"]) {
      expect(fs.readFileSync(path.join(SRT_SANDBOX_DIR, "sandbox-utils.js"), "utf-8")).toContain(name);
    }
  });

  it("未修复的写法不应再出现在 dist 里", () => {
    expect(fs.readFileSync(LINUX_FILE, "utf-8")).not.toContain("allowedPath => candidatePath.startsWith(allowedPath + '/') ||");
  });
});
