/**
 * FileService.readContent 的结果口径 —— 读失败必须能被调用方区分出来。
 *
 * 回归点（2026-09-23）：越界与文件不存在原先都返回 ""，渲染层无法与「真的是空文件」区分，
 * 点开一个已改名/已删除的文件链接只得到一片空白、没有任何提示。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileService } from "./file-service";

let tmp: string;
let sub: string;
let svc: FileService;

beforeEach(() => {
  tmp = path.join(process.cwd(), "temp/tests", `file-service-${randomUUID().slice(0, 8)}`);
  sub = path.join(tmp, "sub");
  mkdirSync(sub, { recursive: true });
  svc = new FileService();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("readContent", () => {
  it("项目内存在的文件 → ok + 内容", () => {
    const f = path.join(tmp, "a.md");
    writeFileSync(f, "# hi");
    expect(svc.readContent(tmp, f)).toEqual({ ok: true, content: "# hi" });
  });

  it("空文件也是 ok：不能被当成读失败，否则界面会误报「文件已变更或删除」", () => {
    const f = path.join(tmp, "empty.md");
    writeFileSync(f, "");
    expect(svc.readContent(tmp, f)).toEqual({ ok: true, content: "" });
  });

  it("文件不存在 → missing", () => {
    expect(svc.readContent(tmp, path.join(tmp, "gone.md"))).toEqual({ ok: false, reason: "missing" });
  });

  it("路径不属于任何已登记项目（baseDir 为 null）→ outside-project", () => {
    const f = path.join(tmp, "b.md");
    writeFileSync(f, "x");
    expect(svc.readContent(null, f)).toEqual({ ok: false, reason: "outside-project" });
  });

  it("存在但在 baseDir 之外 → outside-project", () => {
    const f = path.join(tmp, "c.md");
    writeFileSync(f, "x");
    expect(svc.readContent(sub, f)).toEqual({ ok: false, reason: "outside-project" });
  });

  it("既不在项目内、磁盘上也没有 → 报 missing（存在性先判，别让归属判定掩盖真正原因）", () => {
    expect(svc.readContent(null, path.join(tmp, "nope.md"))).toEqual({ ok: false, reason: "missing" });
  });
});
