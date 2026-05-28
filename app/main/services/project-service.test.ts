import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { Store } from "./store";
import { ProjectService } from "./project-service";

const TEST_DIR = path.join(os.tmpdir(), "easymint-project-service-test");
const TEMPLATE_DIR = path.join(TEST_DIR, "template");
const STORE_DIR = path.join(TEST_DIR, "data");

describe("ProjectService", () => {
  let service: ProjectService;
  let store: Store;

  beforeEach(() => {
    // Clean up any previous test data
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    // Create a minimal template directory
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(TEMPLATE_DIR, "CLAUDE.md"), "# Template");
    fs.writeFileSync(path.join(TEMPLATE_DIR, "README.md"), "# Readme");
    fs.mkdirSync(path.join(TEMPLATE_DIR, "docs"));
    fs.writeFileSync(path.join(TEMPLATE_DIR, "docs", "ARCHITECTURE.md"), "# Architecture");
    // Directories that should be excluded
    fs.mkdirSync(path.join(TEMPLATE_DIR, ".git"));
    fs.writeFileSync(path.join(TEMPLATE_DIR, ".git", "config"), "git data");
    fs.mkdirSync(path.join(TEMPLATE_DIR, "node_modules"));
    fs.writeFileSync(path.join(TEMPLATE_DIR, "node_modules", "dep.js"), "// dep");
    fs.writeFileSync(path.join(TEMPLATE_DIR, ".DS_Store"), "ds_store");
    fs.mkdirSync(path.join(TEMPLATE_DIR, ".playwright-mcp"));
    fs.mkdirSync(path.join(TEMPLATE_DIR, "temp"));

    store = new Store(STORE_DIR);
    service = new ProjectService(store, TEMPLATE_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("list", () => {
    it("初始时应返回空项目列表", () => {
      expect(service.list()).toEqual([]);
    });

    it("创建项目后列表应包含该项目", () => {
      const targetPath = path.join(TEST_DIR, "projects");
      fs.mkdirSync(targetPath, { recursive: true });
      service.create({ name: "测试项目", path: targetPath });
      expect(service.list()).toHaveLength(1);
    });
  });

  describe("create", () => {
    it("应创建项目并返回包含 UUID 的项目对象", () => {
      const targetPath = path.join(TEST_DIR, "projects");
      fs.mkdirSync(targetPath, { recursive: true });
      const project = service.create({ name: "新项目", path: targetPath });

      expect(project.id).toBeDefined();
      expect(project.id).toMatch(/^[0-9a-f-]+$/);
      expect(project.name).toBe("新项目");
      expect(project.path).toBe(targetPath);
      expect(project.status).toBe("setup");
      expect(project.createdAt).toBeDefined();
    });

    it("应复制模板文件到目标目录", () => {
      const targetPath = path.join(TEST_DIR, "projects");
      fs.mkdirSync(targetPath, { recursive: true });
      const project = service.create({ name: "模板测试", path: targetPath });

      const projDir = path.join(project.path, project.name);
      expect(fs.existsSync(projDir)).toBe(true);
      expect(fs.existsSync(path.join(projDir, "CLAUDE.md"))).toBe(true);
      expect(fs.existsSync(path.join(projDir, "README.md"))).toBe(true);
      expect(fs.existsSync(path.join(projDir, "docs", "ARCHITECTURE.md"))).toBe(true);
      // 排除的目录不应被复制
      expect(fs.existsSync(path.join(projDir, ".git"))).toBe(false);
      expect(fs.existsSync(path.join(projDir, "node_modules"))).toBe(false);
    });

    it("应确保目标目录中有 temp 目录", () => {
      const targetPath = path.join(TEST_DIR, "projects");
      fs.mkdirSync(targetPath, { recursive: true });
      const project = service.create({ name: "模板测试", path: targetPath });

      const projDir = path.join(project.path, project.name);
      expect(fs.existsSync(path.join(projDir, "temp"))).toBe(true);
    });

    it("应自动创建不存在的目标目录", () => {
      const targetPath = path.join(TEST_DIR, "auto-create");
      const project = service.create({ name: "自动目录", path: targetPath });

      const projDir = path.join(project.path, project.name);
      expect(fs.existsSync(projDir)).toBe(true);
    });
  });

  describe("delete", () => {
    it("应删除指定项目", () => {
      const targetPath = path.join(TEST_DIR, "projects");
      fs.mkdirSync(targetPath, { recursive: true });
      const project = service.create({ name: "待删除", path: targetPath });

      expect(service.list()).toHaveLength(1);
      service.delete(project.id);
      expect(service.list()).toHaveLength(0);
    });

    it("删除不存在的项目不应报错", () => {
      expect(() => service.delete("nonexistent-id")).not.toThrow();
    });
  });

  describe("get", () => {
    it("应按 ID 返回项目", () => {
      const targetPath = path.join(TEST_DIR, "projects");
      fs.mkdirSync(targetPath, { recursive: true });
      const created = service.create({ name: "查找测试", path: targetPath });

      const found = service.get(created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe("查找测试");
    });

    it("不存在的 ID 应返回 undefined", () => {
      expect(service.get("no-such-id")).toBeUndefined();
    });
  });
});
