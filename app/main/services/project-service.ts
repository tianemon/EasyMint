import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { Store } from "./store";

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  status: "setup" | "development" | "completed";
  description: string;
}

function getTemplateDir(): string {
  // Production: template is bundled as extraResource
  // process.resourcesPath exists only in Electron, not in plain Node/vitest
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, "template");
    if (fs.existsSync(bundled)) return bundled;
  }
  // Development: __dirname = app/main/dist → up 3 levels to project root → template/
  return path.resolve(__dirname, "..", "..", "..", "template");
}

export class ProjectService {
  private templateDir: string;

  constructor(private store: Store, templateDir?: string) {
    this.templateDir = templateDir ?? getTemplateDir();
  }

  list(): Array<Project & { exists: boolean }> {
    return this.store.getProjects().map((p) => ({
      ...p,
      exists: fs.existsSync(p.path),
    }));
  }

  create(opts: { name: string; path: string }): Project {
    const projects = this.store.getProjects();
    const basePath = opts.path.startsWith("~") ? path.join(os.homedir(), opts.path.slice(1)) : opts.path;
    const resolvedPath = path.resolve(basePath, opts.name);
    const project: Project = {
      id: randomUUID(),
      name: opts.name,
      path: resolvedPath,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      status: "setup",
      description: "",
    };

    const targetDir = resolvedPath;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    this.copyTemplate(targetDir);

    projects.push(project);
    this.store.saveProjects(projects);
    return project;
  }

  delete(id: string): void {
    const project = this.store.getProjects().find((p) => p.id === id);
    if (project) {
      if (fs.existsSync(project.path)) {
        fs.rmSync(project.path, { recursive: true, force: true });
      }
      // Also clean up SDK session directory
      const sdkProjectsDir = path.join(os.homedir(), ".easymint", "projects");
      const encodedPath = project.path.replace(/\//g, "-");
      const sdkDir = path.join(sdkProjectsDir, encodedPath);
      if (fs.existsSync(sdkDir)) {
        fs.rmSync(sdkDir, { recursive: true, force: true });
      }
    }
    const projects = this.store.getProjects().filter((p) => p.id !== id);
    this.store.saveProjects(projects);
  }

  get(id: string): (Project & { exists: boolean }) | undefined {
    const p = this.store.getProjects().find((p) => p.id === id);
    if (!p) return undefined;
    return { ...p, exists: fs.existsSync(p.path) };
  }

  private copyTemplate(targetDir: string): void {
    const exclude = new Set([".git", "node_modules", ".DS_Store", ".playwright-mcp", "temp"]);
    const entries = fs.readdirSync(this.templateDir);
    for (const entry of entries) {
      if (exclude.has(entry)) continue;
      const src = path.join(this.templateDir, entry);
      const dest = path.join(targetDir, entry);
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }
    fs.mkdirSync(path.join(targetDir, "temp"), { recursive: true });
  }
}
