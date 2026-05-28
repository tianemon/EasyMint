import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { Store } from "./store";

const TEST_DIR = path.join(os.tmpdir(), "easymint-store-test");

describe("Store", () => {
  let store: Store;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    store = new Store(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("constructor", () => {
    it("应创建数据目录", () => {
      expect(fs.existsSync(TEST_DIR)).toBe(true);
    });

    it("应初始化 projects.json 文件", () => {
      expect(fs.existsSync(path.join(TEST_DIR, "projects.json"))).toBe(true);
    });

    it("应初始化 settings.json 文件", () => {
      expect(fs.existsSync(path.join(TEST_DIR, "settings.json"))).toBe(true);
    });
  });

  describe("projects CRUD", () => {
    it("初始时应返回空项目列表", () => {
      expect(store.getProjects()).toEqual([]);
    });

    it("应能保存和读取项目列表", () => {
      const projects = [
        {
          id: "proj-1",
          name: "测试项目",
          path: "/tmp/test-proj",
          createdAt: "2026-01-01",
          lastOpenedAt: "2026-01-02",
          status: "setup" as const,
          description: "测试",
        },
      ];
      store.saveProjects(projects);
      expect(store.getProjects()).toEqual(projects);
    });

    it("应能保存多个项目", () => {
      const projects = [
        {
          id: "proj-1",
          name: "项目一",
          path: "/tmp/proj-1",
          createdAt: "2026-01-01",
          lastOpenedAt: "2026-01-02",
          status: "setup" as const,
          description: "",
        },
        {
          id: "proj-2",
          name: "项目二",
          path: "/tmp/proj-2",
          createdAt: "2026-02-01",
          lastOpenedAt: "2026-02-02",
          status: "development" as const,
          description: "",
        },
      ];
      store.saveProjects(projects);
      expect(store.getProjects()).toHaveLength(2);
    });
  });

  describe("settings CRUD", () => {
    it("应返回默认设置", () => {
      const settings = store.getSettings();
      expect(settings.theme).toBe("dark");
      expect(settings.terminalFontSize).toBe(14);
    });

    it("应能保存和读取设置", () => {
      const newSettings = {
        ...store.getSettings(),
        theme: "light" as const,
        terminalFontSize: 16,
      };
      store.saveSettings(newSettings);
      expect(store.getSettings().theme).toBe("light");
      expect(store.getSettings().terminalFontSize).toBe(16);
    });
  });

  describe("sessions", () => {
    const projectId = "test-project-1";

    it("应创建 sessions 目录", () => {
      const dir = store.getSessionsDir(projectId);
      expect(fs.existsSync(dir)).toBe(true);
      expect(dir).toContain(projectId);
    });

    it("初始时应返回空 sessions 列表", () => {
      expect(store.listSessions(projectId)).toEqual([]);
    });

    it("应能保存和读取 sessions", () => {
      const sessions = [
        {
          id: "sess-1",
          projectId,
          title: "测试会话",
          createdAt: "2026-01-01",
          lastActiveAt: "2026-01-02",
          claudeSessionId: "claude-1",
          status: "active" as const,
        },
      ];
      store.saveSessions(projectId, sessions);
      expect(store.listSessions(projectId)).toEqual(sessions);
    });

    it("应能删除指定 session", () => {
      const sessions = [
        {
          id: "sess-1",
          projectId,
          title: "会话一",
          createdAt: "2026-01-01",
          lastActiveAt: "2026-01-02",
          claudeSessionId: "claude-1",
          status: "active" as const,
        },
        {
          id: "sess-2",
          projectId,
          title: "会话二",
          createdAt: "2026-02-01",
          lastActiveAt: "2026-02-02",
          claudeSessionId: "claude-2",
          status: "completed" as const,
        },
      ];
      store.saveSessions(projectId, sessions);
      store.deleteSession(projectId, "sess-1");
      const remaining = store.listSessions(projectId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe("sess-2");
    });

    it("删除不存在的 session 不应报错", () => {
      store.saveSessions(projectId, []);
      expect(() => store.deleteSession(projectId, "nonexistent")).not.toThrow();
    });

    it("删除不存在项目的 session 不应报错", () => {
      expect(() => store.deleteSession("no-project", "sess-1")).not.toThrow();
    });
  });
});
