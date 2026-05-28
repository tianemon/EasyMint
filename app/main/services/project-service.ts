import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Store } from "./store";

const TEMPLATE_DIR = path.resolve(import.meta.dirname, "..", "..", "ai-coding-automation-template");

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  status: "setup" | "development" | "completed";
  description: string;
}

export class ProjectService {
  constructor(private store: Store) {}

  list(): Project[] {
    return this.store.getProjects();
  }

  create(opts: { name: string; path: string }): Project {
    const projects = this.store.getProjects();
    const project: Project = {
      id: randomUUID(),
      name: opts.name,
      path: opts.path,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
      status: "setup",
      description: "",
    };

    // Copy template to target directory
    const targetDir = path.join(opts.path, opts.name);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    this.copyTemplate(targetDir);

    projects.push(project);
    this.store.saveProjects(projects);
    return project;
  }

  delete(id: string): void {
    const projects = this.store.getProjects().filter((p) => p.id !== id);
    this.store.saveProjects(projects);
  }

  get(id: string): Project | undefined {
    return this.store.getProjects().find((p) => p.id === id);
  }

  private copyTemplate(targetDir: string): void {
    // Copy all template files except .git and node_modules
    const exclude = new Set([".git", "node_modules", ".DS_Store", ".playwright-mcp", "temp"]);
    const entries = fs.readdirSync(TEMPLATE_DIR);
    for (const entry of entries) {
      if (exclude.has(entry)) continue;
      const src = path.join(TEMPLATE_DIR, entry);
      const dest = path.join(targetDir, entry);
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }
    // Ensure temp directory exists
    fs.mkdirSync(path.join(targetDir, "temp"), { recursive: true });
  }
}
