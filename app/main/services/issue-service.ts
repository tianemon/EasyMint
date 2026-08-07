/**
 * Issue 记录服务 - 纯本地记录，存 <project>/.easymint/issues.json
 * Mint 通过 easymint-ui MCP 的 list_issues 工具读取。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type IssueStatus = "open" | "fixed";

export interface IssueNote {
  content: string;
  createdAt: number;
}

export interface Issue {
  id: string;
  title: string;
  module: string;          // 功能模块（用户手动填，如"登录页"）
  symptom: string;         // 问题现象（用户看到的情况）
  notes: IssueNote[];      // 后续追加内容
  status: IssueStatus;
  createdAt: number;
}

function issuesPath(projectPath: string): string {
  return join(projectPath, ".easymint", "issues.json");
}

function readIssues(projectPath: string): Issue[] {
  const p = issuesPath(projectPath);
  if (!existsSync(p)) return [];
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    const issues = (data.issues as Record<string, unknown>[]) || [];
    return issues.filter((raw) => raw && typeof raw.id === "string").map((raw) => ({
      id: raw.id as string,
      title: raw.title as string,
      module: (raw.module as string) || "",
      symptom: (raw.symptom as string) || "",
      notes: Array.isArray(raw.notes) ? raw.notes : [],
      status: raw.status === "fixed" ? "fixed" : "open",
      createdAt: raw.createdAt as number,
    }));
  } catch {
    return [];
  }
}

function writeIssues(projectPath: string, issues: Issue[]): void {
  const dir = join(projectPath, ".easymint");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = issuesPath(projectPath);
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify({ issues }, null, 2), "utf-8");
  renameSync(tmp, p);
}

export function listIssues(projectPath: string): Issue[] {
  return readIssues(projectPath);
}

export function addIssue(projectPath: string, title: string, module: string, symptom: string): Issue {
  const issues = readIssues(projectPath);
  const issue: Issue = {
    id: randomUUID(),
    title: title.trim(),
    module: module.trim(),
    symptom: symptom.trim(),
    notes: [],
    status: "open",
    createdAt: Date.now(),
  };
  issues.unshift(issue);
  writeIssues(projectPath, issues);
  return issue;
}

export function setStatus(projectPath: string, id: string, status: IssueStatus): void {
  const issues = readIssues(projectPath);
  const issue = issues.find((i) => i.id === id);
  if (issue) {
    issue.status = status;
    writeIssues(projectPath, issues);
  }
}

export function appendNote(projectPath: string, id: string, content: string): void {
  const issues = readIssues(projectPath);
  const issue = issues.find((i) => i.id === id);
  if (issue) {
    issue.notes.push({ content: content.trim(), createdAt: Date.now() });
    writeIssues(projectPath, issues);
  }
}

export function deleteIssue(projectPath: string, id: string): void {
  const issues = readIssues(projectPath).filter((i) => i.id !== id);
  writeIssues(projectPath, issues);
}
