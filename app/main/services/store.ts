import fs from "fs";
import path from "path";
import os from "os";

export const DATA_DIR = path.join(os.homedir(), ".ai-coding-automation");

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  status: "setup" | "development" | "completed";
  description: string;
}

interface Session {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  lastActiveAt: string;
  claudeSessionId: string;
  status: "active" | "completed";
}

interface Settings {
  defaultProjectDir: string;
  claudePath: string;
  terminalFontSize: number;
  evaluateMode?: boolean;
}

export class Store {
  private dataDir: string;
  private projectsPath: string;
  private settingsPath: string;

  constructor(baseDir?: string) {
    this.dataDir = baseDir ?? DATA_DIR;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.projectsPath = path.join(this.dataDir, "projects.json");
    this.settingsPath = path.join(this.dataDir, "settings.json");
    this.ensureFiles();
  }

  private ensureFiles(): void {
    if (!fs.existsSync(this.projectsPath)) {
      fs.writeFileSync(this.projectsPath, JSON.stringify({ projects: [] }, null, 2));
    }
    if (!fs.existsSync(this.settingsPath)) {
      const defaults: Settings = {
        defaultProjectDir: os.homedir(),
        claudePath: "",
        terminalFontSize: 14,
      };
      fs.writeFileSync(this.settingsPath, JSON.stringify(defaults, null, 2));
    }
  }

  getProjects(): Project[] {
    const raw = fs.readFileSync(this.projectsPath, "utf-8");
    return JSON.parse(raw).projects;
  }

  saveProjects(projects: Project[]): void {
    fs.writeFileSync(this.projectsPath, JSON.stringify({ projects }, null, 2));
  }

  getSettings(): Settings {
    const raw = fs.readFileSync(this.settingsPath, "utf-8");
    return JSON.parse(raw);
  }

  saveSettings(settings: Settings): void {
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  getSessionsDir(projectId: string): string {
    const dir = path.join(this.dataDir, "sessions", projectId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  listSessions(projectId: string): Session[] {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    if (!fs.existsSync(sessionsFile)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(sessionsFile, "utf-8")).sessions;
  }

  saveSessions(projectId: string, sessions: Session[]): void {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    fs.writeFileSync(sessionsFile, JSON.stringify({ sessions }, null, 2));
  }

  deleteSession(projectId: string, sessionId: string): void {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    if (!fs.existsSync(sessionsFile)) {
      return;
    }
    const data = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
    data.sessions = data.sessions.filter((s: Session) => s.id !== sessionId);
    fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 2));
  }
}
