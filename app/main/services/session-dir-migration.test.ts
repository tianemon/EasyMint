/**
 * 会话目录迁移单测：EM 旧编码 `-Users-amon-x` → Pi 默认编码 `--Users-amon-x--`。
 *
 * 用注入的 resolveSessionDir 替身，避免依赖真实 SDK 与真实家目录（CLAUDE.md 测试纪律）。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { migrateLegacySessionDirs } from "./session-dir-migration";

/** Pi 的会话目录编码（与 packages/coding-agent getDefaultSessionDirPath 同规则） */
const encodePi = (cwd: string): string =>
  `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;

/** EM 的旧编码（本次改动要迁走的形态） */
const encodeEmLegacy = (cwd: string): string => cwd.replace(/[:/\\]/g, "-");

/** 写一个最小会话文件：首行是带 cwd 的会话头 */
function writeSessionFile(dir: string, name: string, cwd: string, body = ""): void {
  fs.mkdirSync(dir, { recursive: true });
  const header = JSON.stringify({ type: "session", version: 3, id: "019fb1d7-60db-7185-9164-2fa3b40feb59", cwd });
  fs.writeFileSync(path.join(dir, name), `${header}\n${body}`);
}

describe("会话目录迁移（EM 旧编码 → Pi 默认编码）", () => {
  let base: string;

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "session-dir-migration-"));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  /** 与生产一致：目标目录落在同一 base 下（沙箱内自洽） */
  const resolveInBase = (cwd: string): string => path.join(base, encodePi(cwd));

  it("旧编码目录整体改名为 Pi 编码，会话文件随之保留", () => {
    const cwd = "/Users/amon/project";
    const legacyName = encodeEmLegacy(cwd);
    writeSessionFile(path.join(base, legacyName), "2026-09-20T00-00-00-000Z_019fb1d7-60db-7185-9164-2fa3b40feb59.jsonl", cwd);

    const result = migrateLegacySessionDirs(base, resolveInBase);

    expect(result.renamed).toBe(1);
    expect(result.failed).toBe(0);
    expect(fs.existsSync(path.join(base, encodePi(cwd)))).toBe(true);
    expect(fs.existsSync(path.join(base, legacyName))).toBe(false);
    const kept = fs.readdirSync(path.join(base, encodePi(cwd)));
    expect(kept).toHaveLength(1);
  });

  it("重复执行幂等：已是 Pi 编码的目录不再处理", () => {
    const cwd = "/Users/amon/project";
    writeSessionFile(path.join(base, encodeEmLegacy(cwd)), "a.jsonl", cwd);

    expect(migrateLegacySessionDirs(base, resolveInBase).renamed).toBe(1);
    const second = migrateLegacySessionDirs(base, resolveInBase);

    expect(second.renamed).toBe(0);
    expect(second.merged).toBe(0);
    expect(second.skipped).toBe(1);
    expect(fs.existsSync(path.join(base, encodePi(cwd)))).toBe(true);
  });

  it("顶层无会话文件时，从 subagents 子目录的会话判定 cwd", () => {
    const cwd = "/Users/amon/project";
    const legacyName = encodeEmLegacy(cwd);
    writeSessionFile(path.join(base, legacyName, "019fd268-e591-7620-a676-2bab7b1b1c39", "subagents"), "b.jsonl", cwd);

    const result = migrateLegacySessionDirs(base, resolveInBase);

    expect(result.renamed).toBe(1);
    expect(
      fs.existsSync(
        path.join(base, encodePi(cwd), "019fd268-e591-7620-a676-2bab7b1b1c39", "subagents", "b.jsonl"),
      ),
    ).toBe(true);
  });

  it("目标目录已存在时并入：同名文件保留目标那份，其余搬入", () => {
    const cwd = "/Users/amon/project";
    const legacyName = encodeEmLegacy(cwd);
    const piName = encodePi(cwd);
    writeSessionFile(path.join(base, legacyName), "same.jsonl", cwd, "旧");
    writeSessionFile(path.join(base, legacyName), "only-legacy.jsonl", cwd, "旧独有");
    writeSessionFile(path.join(base, piName), "same.jsonl", cwd, "新");

    const result = migrateLegacySessionDirs(base, resolveInBase);

    expect(result.merged).toBe(1);
    expect(fs.existsSync(path.join(base, legacyName))).toBe(false);
    const target = fs.readFileSync(path.join(base, piName, "same.jsonl"), "utf-8");
    expect(target.endsWith("新")).toBe(true); // 不覆盖既有数据
    expect(fs.existsSync(path.join(base, piName, "only-legacy.jsonl"))).toBe(true);
  });

  it("空目录不猜路径：跳过且保持原样", () => {
    const emptyDir = path.join(base, "-Users-amon-empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const result = migrateLegacySessionDirs(base, resolveInBase);

    expect(result.skipped).toBe(1);
    expect(result.renamed).toBe(0);
    expect(fs.existsSync(emptyDir)).toBe(true);
  });

  it("首行无 cwd（或非法 JSON）时跳过，不误迁", () => {
    const noCwdDir = path.join(base, "-Users-amon-nocwd");
    fs.mkdirSync(noCwdDir, { recursive: true });
    fs.writeFileSync(path.join(noCwdDir, "x.jsonl"), `${JSON.stringify({ type: "session", version: 3 })}\n`);
    const brokenDir = path.join(base, "-Users-amon-broken");
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "y.jsonl"), "not-json\n");

    const result = migrateLegacySessionDirs(base, resolveInBase);

    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(0);
    expect(fs.existsSync(noCwdDir)).toBe(true);
    expect(fs.existsSync(brokenDir)).toBe(true);
  });

  it("sessionsBase 不存在时静默返回零值", () => {
    const result = migrateLegacySessionDirs(path.join(base, "not-exist"), resolveInBase);
    expect(result).toEqual({ renamed: 0, merged: 0, skipped: 0, failed: 0 });
  });

  it("真实场景：resolveSessionDir 带 mkdir 副作用时仍走整体改名", () => {
    // 回归防护：生产的 getPiSessionDir 会 mkdir 目标目录（SDK 默认目录的副作用），
    // 若把"目标已存在"当判据，就会永远落进并入分支（实测演练暴露过）。
    const cwd = "/Users/amon/project";
    const legacyName = encodeEmLegacy(cwd);
    writeSessionFile(path.join(base, legacyName), "a.jsonl", cwd);

    const mkdirThenResolve = (c: string): string => {
      const d = path.join(base, encodePi(c));
      fs.mkdirSync(d, { recursive: true }); // 模拟副作用
      return d;
    };
    const result = migrateLegacySessionDirs(base, mkdirThenResolve);

    expect(result.renamed).toBe(1);
    expect(result.merged).toBe(0);
    expect(result.failed).toBe(0);
    expect(fs.readdirSync(path.join(base, encodePi(cwd)))).toEqual(["a.jsonl"]);
  });
});
