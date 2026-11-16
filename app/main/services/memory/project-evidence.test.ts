import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  collectEvidence,
  describeEvidence,
  evidenceChanged,
  walkTree,
  type EvidenceProbe,
} from "./project-evidence";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function repo(table: Record<string, string>, files: { latestMtime: number; count: number; topDirs: Array<{ dir: string; count: number }> } | null = null): EvidenceProbe {
  return {
    run: (command) => (command in table ? table[command]! : null),
    walk: () => files,
  };
}

const GIT: Record<string, string> = {
  "git rev-parse --short HEAD": "c839f47",
  "git rev-list --count HEAD": "812",
  "git log -5 --pretty=%ad|%s --date=short": "2026-11-15|merge windows hardening\n2026-11-15|fix tray minimize",
  "git status --porcelain": " M a.ts\n M b.ts\n?? c.ts",
  "git log -1 --format=%ct": "1763200000",
  "git ls-files": "app/main/a.ts\napp/main/b.ts\napp/renderer/c.tsx\ntemp/scratch.md\ntemp/log.txt",
};

it("有 git 时用 HEAD + 提交数作为校验信号", () => {
  const evidence = collectEvidence("/repo", repo(GIT));
  expect(evidence.git).toEqual({
    head: "c839f47",
    commits: 812,
    dirty: 3,
    lastCommitAt: 1_763_200_000_000,
    recent: [
      { date: "2026-11-15", subject: "merge windows hardening" },
      { date: "2026-11-15", subject: "fix tray minimize" },
    ],
  });
  expect(evidence.signal).toHaveLength(16);
});

it("改动集中目录取自跟踪文件清单，临时目录也会按仓库内容计，不靠全盘遍历", () => {
  const evidence = collectEvidence("/repo", repo(GIT));
  expect(evidence.files).toEqual({
    count: 5,
    latestMtime: 1_763_200_000_000,
    topDirs: [
      { dir: "app", count: 3 },
      { dir: "temp", count: 2 },
    ],
  });
});

it("未提交文件数变化不改信号（它变得太频繁，不能当失效判据）", () => {
  const before = collectEvidence("/repo", repo(GIT));
  const after = collectEvidence("/repo", repo({ ...GIT, "git status --porcelain": " M a.ts" }));
  expect(evidenceChanged(before.signal, after)).toBe(false);
  expect(after.git?.dirty).toBe(1);
  const committed = collectEvidence("/repo", repo({ ...GIT, "git rev-list --count HEAD": "813" }));
  expect(evidenceChanged(before.signal, committed)).toBe(true);
});

it("没有 git 时降级到文件证据，仍能给出信号", () => {
  const evidence = collectEvidence("/plain", repo({}, { latestMtime: 1_700_000_000_000, count: 42, topDirs: [{ dir: "src", count: 30 }] }));
  expect(evidence.git).toBeUndefined();
  expect(evidence.files?.count).toBe(42);
  expect(evidence.signal).toHaveLength(16);
  expect(evidence.hasContent).toBe(true);
});

it("既无 git 又无文件时给出空信号，不抛错", () => {
  const evidence = collectEvidence("/empty", repo({}));
  expect(evidence.hasContent).toBe(false);
  expect(evidence.signal).toHaveLength(16);
});

it("证据摘要里明确写出无 git，便于模型知道降级了", () => {
  const text = describeEvidence(collectEvidence("/plain", repo({}, { latestMtime: 1_700_000_000_000, count: 3, topDirs: [{ dir: "docs", count: 3 }] })));
  expect(text).toContain("git: 无");
  expect(text).toContain("最后提交 2023-11-14");
  expect(text).toContain("docs(3)");
});

it("遍历目录树时跳过依赖与构建产物", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-evidence-"));
  dirs.push(root);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "a.ts"), "a");
  fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "x");
  fs.writeFileSync(path.join(root, "README.md"), "r");
  const walked = walkTree(root)!;
  expect(walked.count).toBe(2);
  expect(walked.topDirs.map((item) => item.dir).sort()).toEqual(["src"]);
  expect(walked.latestMtime).toBeGreaterThan(0);
});
