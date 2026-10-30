/**
 * run.json 读写的守卫测试。
 *
 * 为什么钉这一段：`.easymint/run.json` 是「运行面板」的唯一数据源，Mint 会直接写它。
 * 用户/旧版本可能在同一个文件里放自定义字段，保存时整份覆盖就会静默丢配置；
 * 而文件损坏时若抛错，运行面板会整块不可用。两件事都属于「出错了没人发现」。
 *
 * 只覆盖文件读写与字段合并，不起进程、不碰真实 home。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));

import { detectRunnable, saveRunJson } from "./process-service";

let project: string;
let runJson: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "em-runjson-"));
  mkdirSync(join(project, ".easymint"), { recursive: true });
  runJson = join(project, ".easymint", "run.json");
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("saveRunJson", () => {
  it("保存时保留文件里已有的自定义字段与命令上的未知字段", () => {
    writeFileSync(runJson, JSON.stringify({
      schemaVersion: 3,
      note: "人工添加",
      commands: [{ run_command: "npm run dev", label: "旧名", customFlag: true }],
    }));

    saveRunJson(project, [
      { id: "npm run dev", platform: "vite", label: "开发服务", run_command: "npm run dev", cwd: "app" },
    ]);

    const saved = JSON.parse(readFileSync(runJson, "utf8"));
    // 文件级未知字段不能丢
    expect(saved.schemaVersion).toBe(3);
    expect(saved.note).toBe("人工添加");
    // 命令级未知字段按 run_command 匹配后保留，已知字段以入参为准
    expect(saved.commands).toHaveLength(1);
    expect(saved.commands[0].customFlag).toBe(true);
    expect(saved.commands[0].label).toBe("开发服务");
    expect(saved.commands[0].cwd).toBe("app");
  });

  it("没有旧文件时直接写出 commands，cwd 缺省补 '.'", () => {
    saveRunJson(project, [
      { id: "npm start", platform: "nodejs", label: "start", run_command: "npm start" },
    ]);

    const saved = JSON.parse(readFileSync(runJson, "utf8"));
    expect(Object.keys(saved)).toEqual(["commands"]);
    expect(saved.commands[0].cwd).toBe(".");
    expect(saved.commands[0].url).toBe("");
  });

  it("旧文件损坏时不抛错，按只有 commands 写出（保留现场留给下次保存）", () => {
    writeFileSync(runJson, "{ 这不是 json");
    expect(() => saveRunJson(project, [
      { id: "node index.js", platform: "nodejs", label: "index", run_command: "node index.js" },
    ])).not.toThrow();

    const saved = JSON.parse(readFileSync(runJson, "utf8"));
    expect(saved.commands).toHaveLength(1);
    expect(saved.commands[0].run_command).toBe("node index.js");
  });
});

describe("detectRunnable", () => {
  it("读回已保存的命令（id 取 run_command，与前端编辑契约一致）", () => {
    writeFileSync(runJson, JSON.stringify({
      commands: [{ run_command: "npm run dev", platform: "vite", label: "开发", url: "http://localhost:5173" }],
    }));

    const list = detectRunnable(project);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("npm run dev");
    expect(list[0].url).toBe("http://localhost:5173");
  });

  it("run.json 损坏时返回空列表而不是抛错（运行面板按无脚本展示）", () => {
    writeFileSync(runJson, "not a json at all");
    expect(detectRunnable(project)).toEqual([]);
  });

  it("缺少 run.json 时返回空列表", () => {
    expect(detectRunnable(project)).toEqual([]);
  });
});
