import fs from "fs";
import path from "path";
import os from "os";

export const DATA_DIR = path.join(os.homedir(), ".easymint");

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
  tddMode?: boolean;
  screenshotVerification?: boolean;
  apiBaseUrl?: string;
  apiKey?: string;
  lastProjectId?: string;
}

export class Store {
  private dataDir: string;
  private projectsPath: string;
  private settingsPath: string;

  constructor(baseDir?: string) {
    this.dataDir = baseDir ?? DATA_DIR;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.projectsPath = path.join(this.dataDir, "projects.json");
    this.settingsPath = path.join(this.dataDir, "sdk-config", "settings.json");
    this.ensureFiles();
  }

  private ensureFiles(): void {
    if (!fs.existsSync(this.projectsPath)) {
      fs.writeFileSync(this.projectsPath, JSON.stringify({ projects: [] }, null, 2));
    }
    if (!fs.existsSync(this.settingsPath)) {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.settingsPath, JSON.stringify({
        defaultProjectDir: os.homedir(),
        claudePath: "",
        terminalFontSize: 14,
      }, null, 2));
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
    if (!fs.existsSync(this.settingsPath)) {
      return { defaultProjectDir: os.homedir(), claudePath: "", terminalFontSize: 14 };
    }
    const raw = fs.readFileSync(this.settingsPath, "utf-8");
    const data = JSON.parse(raw);
    // SDK stores API key under env.ANTHROPIC_AUTH_TOKEN, map back to Mint format
    const env = data.env || {};
    return {
      defaultProjectDir: data.defaultProjectDir || os.homedir(),
      claudePath: data.claudePath || "",
      terminalFontSize: data.terminalFontSize || 14,
      evaluateMode: data.evaluateMode,
      tddMode: data.tddMode,
      screenshotVerification: data.screenshotVerification,
      apiBaseUrl: env.ANTHROPIC_BASE_URL || data.apiBaseUrl,
      apiKey: env.ANTHROPIC_AUTH_TOKEN || data.apiKey,
      lastProjectId: data.lastProjectId || undefined,
    };
  }

  getLastProjectId(): string | null {
    return this.getSettings().lastProjectId ?? null;
  }

  setLastProjectId(projectId: string): void {
    const settings = this.getSettings();
    settings.lastProjectId = projectId;
    this.saveSettings(settings);
  }

  saveSettings(settings: Settings): void {
    const dir = path.dirname(this.settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Read existing SDK settings to preserve other config
    let data: Record<string, unknown> = {};
    if (fs.existsSync(this.settingsPath)) {
      try { data = JSON.parse(fs.readFileSync(this.settingsPath, "utf-8")); } catch { /* overwrite */ }
    }

    // Merge Mint settings into the SDK settings file
    data.defaultProjectDir = settings.defaultProjectDir;
    data.claudePath = settings.claudePath;
    data.terminalFontSize = settings.terminalFontSize;
    data.evaluateMode = settings.evaluateMode;
    data.tddMode = settings.tddMode;
    data.screenshotVerification = settings.screenshotVerification;
    data.lastProjectId = settings.lastProjectId;

    // Inject API key into SDK's expected env format
    const env = (data.env as Record<string, string>) || {};
    if (settings.apiKey) env.ANTHROPIC_AUTH_TOKEN = settings.apiKey;
    if (settings.apiBaseUrl) env.ANTHROPIC_BASE_URL = settings.apiBaseUrl;
    data.env = env;

    fs.writeFileSync(this.settingsPath, JSON.stringify(data, null, 2));
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
