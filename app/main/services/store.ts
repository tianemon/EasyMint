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
  model?: string;
  availableModels?: string[];
  lastProjectId?: string;
  setupComplete?: boolean;
}

const EM_DEFAULTS = {
  setupComplete: false,
  defaultProjectDir: os.homedir(),
  claudePath: "",
  terminalFontSize: 14,
};

export class Store {
  private dataDir: string;
  private projectsPath: string;
  private emSettingsPath: string;
  private sdkSettingsPath: string;

  constructor(baseDir?: string) {
    this.dataDir = baseDir ?? DATA_DIR;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.projectsPath = path.join(this.dataDir, "projects.json");
    this.emSettingsPath = path.join(this.dataDir, "em-settings.json");
    this.sdkSettingsPath = path.join(this.dataDir, "settings.json");
    this.ensureFiles();
  }

  private ensureFiles(): void {
    if (!fs.existsSync(this.projectsPath)) {
      fs.writeFileSync(this.projectsPath, JSON.stringify({ projects: [] }, null, 2));
    }
    // EM settings
    if (!fs.existsSync(this.emSettingsPath)) {
      fs.writeFileSync(this.emSettingsPath, JSON.stringify(EM_DEFAULTS, null, 2));
    }
    // SDK settings (don't touch if SDK already created it; only create minimal if missing)
    if (!fs.existsSync(this.sdkSettingsPath)) {
      const dir = path.dirname(this.sdkSettingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.sdkSettingsPath, JSON.stringify({}, null, 2));
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
    // Read EM-specific settings
    let emData: Record<string, unknown> = {};
    if (fs.existsSync(this.emSettingsPath)) {
      try { emData = JSON.parse(fs.readFileSync(this.emSettingsPath, "utf-8")); } catch { /* ignore */ }
    }

    // Read SDK settings (for apiKey, apiBaseUrl)
    let sdkData: Record<string, unknown> = {};
    if (fs.existsSync(this.sdkSettingsPath)) {
      try { sdkData = JSON.parse(fs.readFileSync(this.sdkSettingsPath, "utf-8")); } catch { /* ignore */ }
    }
    const env = (sdkData.env as Record<string, string>) || {};

    return {
      defaultProjectDir: (emData.defaultProjectDir as string) || EM_DEFAULTS.defaultProjectDir,
      claudePath: (emData.claudePath as string) || "",
      terminalFontSize: (emData.terminalFontSize as number) || EM_DEFAULTS.terminalFontSize,
      evaluateMode: emData.evaluateMode as boolean | undefined,
      tddMode: emData.tddMode as boolean | undefined,
      screenshotVerification: emData.screenshotVerification as boolean | undefined,
      apiBaseUrl: env.ANTHROPIC_BASE_URL || (sdkData.apiBaseUrl as string),
      apiKey: env.ANTHROPIC_AUTH_TOKEN || (sdkData.apiKey as string),
      model: (emData.model as string) || undefined,
      availableModels: (emData.availableModels as string[]) || undefined,
      setupComplete: emData.setupComplete as boolean | undefined,
      lastProjectId: emData.lastProjectId as string | undefined,
    };
  }

  getLastProjectId(): string | null {
    return this.getSettings().lastProjectId ?? null;
  }

  setLastProjectId(projectId: string): void {
    const s = this.getSettings();
    s.lastProjectId = projectId;
    this.writeEmSettings(s);
  }

  /** Write EM-only fields to ~/.easymint/settings.json */
  private writeEmSettings(settings: Settings): void {
    const dir = path.dirname(this.emSettingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: Record<string, unknown> = {};
    if (fs.existsSync(this.emSettingsPath)) {
      try { Object.assign(data, JSON.parse(fs.readFileSync(this.emSettingsPath, "utf-8"))); } catch { /* overwrite */ }
    }
    data.defaultProjectDir = settings.defaultProjectDir;
    data.claudePath = settings.claudePath;
    data.terminalFontSize = settings.terminalFontSize;
    data.evaluateMode = settings.evaluateMode;
    data.tddMode = settings.tddMode;
    data.screenshotVerification = settings.screenshotVerification;
    data.lastProjectId = settings.lastProjectId;
    data.setupComplete = settings.setupComplete;
    if (settings.model) data.model = settings.model;
    if (settings.availableModels) data.availableModels = settings.availableModels;
    fs.writeFileSync(this.emSettingsPath, JSON.stringify(data, null, 2));
  }

  /** Write SDK fields (apiKey, apiBaseUrl) to ~/.easymint/sdk-config/settings.json */
  private writeSdkSettings(settings: Settings): void {
    const dir = path.dirname(this.sdkSettingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: Record<string, unknown> = {};
    if (fs.existsSync(this.sdkSettingsPath)) {
      try { Object.assign(data, JSON.parse(fs.readFileSync(this.sdkSettingsPath, "utf-8"))); } catch { /* overwrite */ }
    }
    // Inject API key into SDK's expected env format
    const env = (data.env as Record<string, string>) || {};
    if (settings.apiKey) env.ANTHROPIC_AUTH_TOKEN = settings.apiKey;
    if (settings.apiBaseUrl) env.ANTHROPIC_BASE_URL = settings.apiBaseUrl;
    data.env = env;
    fs.writeFileSync(this.sdkSettingsPath, JSON.stringify(data, null, 2));
  }

  saveSettings(settings: Settings): void {
    this.writeEmSettings(settings);
    this.writeSdkSettings(settings);
  }

  getSessionsDir(projectId: string): string {
    const dir = path.join(this.dataDir, "sessions", projectId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  listSessions(projectId: string): Session[] {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    if (!fs.existsSync(sessionsFile)) return [];
    return JSON.parse(fs.readFileSync(sessionsFile, "utf-8")).sessions;
  }

  saveSessions(projectId: string, sessions: Session[]): void {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    fs.writeFileSync(sessionsFile, JSON.stringify({ sessions }, null, 2));
  }

  deleteSession(projectId: string, sessionId: string): void {
    const sessionsFile = path.join(this.getSessionsDir(projectId), "sessions.json");
    if (!fs.existsSync(sessionsFile)) return;
    const data = JSON.parse(fs.readFileSync(sessionsFile, "utf-8"));
    data.sessions = data.sessions.filter((s: Session) => s.id !== sessionId);
    fs.writeFileSync(sessionsFile, JSON.stringify(data, null, 2));
  }
}
