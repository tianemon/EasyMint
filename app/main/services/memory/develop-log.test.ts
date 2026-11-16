import { expect, it } from "vitest";
import {
  EMPTY_DEVELOP_LOG,
  latestRecordDate,
  parseDevelopLog,
  renderProjectSection,
} from "./develop-log";

const SAMPLE = `# 需求跟进

> 说明：本文件是项目进度与交接的唯一真相源。

---

## 当前进度快照

**2026-11-15 Windows 两项 P1 已修复并合并主线（1694cad9，未推送）**：在 Windows 提交 e1f9a60a 上补修复 1f6877ce，先 172 项验收再合并；整合后 1893 通过／1 跳过。未推送。

**2026-11-15 迁移恢复已本地修复（9dad8ac6）**：来源失败隔离、失效 worker 重建、Windows／UNC 路径重定位已补齐。

**2026-11-14 主对话定制**：可叠加协作模式。


## 开发记录索引（按日期正序（最新追加在末尾），当天记录写入对应文件，只增不改）

- [2026-11-11](开发记录/2026-11-11.md)：v1.5.5 手机网页、后台会话与 MCP 缓存优化的发布准备与验证。

- [2026-11-14](开发记录/2026-11-14.md) — 主对话定制与可叠加协作模式（00653686）

- [2026-11-15](开发记录/2026-11-15.md)：统一记忆、无损迁移、项目记录托管及独立复核（abe84f6a，未推送）。
`;

it("解析当前进度快照与开发记录索引", () => {
  const log = parseDevelopLog(SAMPLE);
  expect(log.snapshot).toHaveLength(3);
  expect(log.snapshot[0]).toMatchObject({ date: "2026-11-15", title: "Windows 两项 P1 已修复并合并主线（1694cad9，未推送）" });
  expect(log.snapshot[0]!.body).toContain("1893 通过");
  expect(log.index.map((item) => item.date)).toEqual(["2026-11-11", "2026-11-14", "2026-11-15"]);
  expect(log.index[1]).toEqual({ date: "2026-11-14", path: "开发记录/2026-11-14.md", summary: "主对话定制与可叠加协作模式（00653686）" });
});

it("渲染只保留当前一条摘要 + 变更流水，整块不超过上限", () => {
  const text = renderProjectSection(parseDevelopLog(SAMPLE), { maxChars: 400 });
  expect(text.length).toBeLessThanOrEqual(400);
  expect(text).toContain("当前：11/15 Windows 两项 P1");
  expect(text).toContain("变更：");
  expect(text.indexOf("11/15 统一记忆")).toBeLessThan(text.indexOf("11/11 v1.5.5"));
});

it("记录落后于 git 时明确标出，不假装是最新", () => {
  const text = renderProjectSection(parseDevelopLog(SAMPLE), {
    gitLastCommitDate: "2026-11-16",
    gitCommitsSince: 4,
  });
  expect(text).toContain("记录落后：2026-11-16 之后还有 4 次提交未记录");
});

it("空文本或结构不符时返回空结构，不抛错", () => {
  expect(parseDevelopLog("")).toEqual(EMPTY_DEVELOP_LOG);
  expect(parseDevelopLog("# 只有标题\n\n没有快照也没有索引\n")).toEqual(EMPTY_DEVELOP_LOG);
  expect(renderProjectSection(EMPTY_DEVELOP_LOG)).toBe("");
});

it("latestRecordDate 取快照、索引与 git 提交日的最大值", () => {
  const log = parseDevelopLog(SAMPLE);
  expect(latestRecordDate(log)).toBe("2026-11-15");
  expect(latestRecordDate(log, "2026-11-16")).toBe("2026-11-16");
  expect(latestRecordDate(EMPTY_DEVELOP_LOG)).toBeUndefined();
});
