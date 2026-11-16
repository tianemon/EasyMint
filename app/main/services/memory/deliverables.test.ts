import { expect, it } from "vitest";
import type { ProjectEvidence } from "./project-evidence";
import { buildDeliverables, KEY_MACHINE, KEY_PROGRESS, KEY_RULES } from "./deliverables";
import { planDelivery } from "./context-plan";

const MEMORY = `# MEMORY

- 别先给方案再问要不要做 <!-- m:aaa111 -->
- 本机只有 8GB，别跑重任务 <!-- m:bbb222 -->
`;

const DEVELOP = `# 需求跟进

## 当前进度快照

**2026-11-15 Windows 两项 P1 已修复**：合并 1694cad9，1893 通过。

## 开发记录索引

- [2026-11-14](开发记录/2026-11-14.md)：主对话定制
- [2026-11-15](开发记录/2026-11-15.md)：统一记忆
`;

const EVIDENCE: ProjectEvidence = {
  git: { head: "c839f47", commits: 812, dirty: 3, lastCommitAt: 0, recent: [{ date: "2026-11-15", subject: "merge windows" }] },
  files: { latestMtime: 0, count: 1200, topDirs: [{ dir: "app", count: 691 }] },
  signal: "abc123",
  hasContent: true,
};

it("三类信息各生成一个条目，优先级为 约定 > 项目 > 本机", () => {
  const items = buildDeliverables({
    memory: MEMORY,
    projectName: "EasyMint",
    developLog: DEVELOP,
    machine: { fingerprint: "fp1", section: "- Apple M2 · 8 核 · 8GB" },
  });
  expect(items.map((item) => item.key)).toEqual([KEY_RULES, KEY_PROGRESS, KEY_MACHINE]);
  expect(items.map((item) => item.priority)).toEqual([1, 2, 3]);
  expect(items[0]!.text).toContain("别先给方案再问要不要做");
});

it("人设不进记忆条目：避免与协作设置两份互相覆盖", () => {
  const items = buildDeliverables({ memory: MEMORY });
  expect(items.map((item) => item.key)).toEqual([KEY_RULES]);
  expect(JSON.stringify(items)).not.toMatch(/昵称|人设|性格/u);
});

it("有开发记录时用它作项目进展，并带上截至日期", () => {
  const items = buildDeliverables({ memory: null, projectName: "EasyMint", developLog: DEVELOP, evidence: EVIDENCE });
  const progress = items.find((item) => item.key === KEY_PROGRESS)!;
  expect(progress.text).toContain("来源：项目开发记录，截至 2026-11-15");
  expect(progress.text).toContain("11/15");
  expect(progress.text).not.toContain("HEAD c839f47");
});

it("无开发记录时降级为仓库事实，并明确说明没有记录", () => {
  const items = buildDeliverables({ memory: null, projectName: "demo", developLog: null, evidence: EVIDENCE });
  const progress = items.find((item) => item.key === KEY_PROGRESS)!;
  expect(progress.text).toContain("该目录无开发记录");
  expect(progress.text).toContain("HEAD c839f47");
});

it("既无开发记录也无仓库证据时，用最近一场会话的路标兜底", () => {
  const items = buildDeliverables({
    memory: null,
    projectName: "demo",
    session: { turns: 4, lastUser: "把注入改到尾部", lastAssistant: "已改成尾部增量。" },
  });
  const progress = items.find((item) => item.key === KEY_PROGRESS)!;
  expect(progress.text).toContain("来源：最近一场会话的路标");
  expect(progress.text).toContain("把注入改到尾部");
});

it("纯问候的会话不作为项目进展", () => {
  const items = buildDeliverables({ memory: null, projectName: "demo", session: { turns: 1, lastUser: "你好", lastAssistant: "在" } });
  expect(items).toEqual([]);
});

it("既无开发记录又无证据时不产出项目条目", () => {
  const items = buildDeliverables({ memory: null, projectName: "empty" });
  expect(items).toEqual([]);
});

it("版本号只随内容变化：同样的输入产出同样的版本，注入不会重复", () => {
  const a = buildDeliverables({ memory: MEMORY, machine: { fingerprint: "fp1", section: "- spec" } });
  const b = buildDeliverables({ memory: MEMORY, machine: { fingerprint: "fp1", section: "- spec" } });
  expect(a.map((item) => item.revision)).toEqual(b.map((item) => item.revision));
  const first = planDelivery(a);
  expect(planDelivery(b, { delivered: new Map(first.items.map((i) => [i.key, i.revision])) }).reason).toBe("none");
});

it("本机指纹变了才更新版本号", () => {
  const a = buildDeliverables({ machine: { fingerprint: "fp1", section: "- spec" } });
  const b = buildDeliverables({ machine: { fingerprint: "fp2", section: "- spec" } });
  expect(a[0]!.revision).not.toBe(b[0]!.revision);
});
