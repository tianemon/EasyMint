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
  thinkingBudget?: number; // 0 = disabled, >0 = token budget
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

  // ── Conversation management (Proma-style) ──

  private get convDir(): string {
    const d = path.join(this.dataDir, "conversations");
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  private get convIndexPath(): string { return path.join(this.dataDir, "conversations.json"); }

  private readConvIndex(): ConversationMeta[] {
    if (!fs.existsSync(this.convIndexPath)) return [];
    return JSON.parse(fs.readFileSync(this.convIndexPath, "utf-8")).conversations || [];
  }

  private writeConvIndex(convs: ConversationMeta[]): void {
    fs.writeFileSync(this.convIndexPath, JSON.stringify({ conversations: convs }, null, 2));
  }

  listConversations(): ConversationMeta[] {
    return this.readConvIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  createConversation(title = "新对话"): ConversationMeta {
    const convs = this.readConvIndex();
    const meta: ConversationMeta = {
      id: crypto.randomUUID(),
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    convs.push(meta);
    this.writeConvIndex(convs);
    // Create empty message file
    const msgPath = path.join(this.convDir, `${meta.id}.jsonl`);
    fs.writeFileSync(msgPath, "");
    return meta;
  }

  getConversation(id: string): ConversationMeta | null {
    return this.readConvIndex().find(c => c.id === id) ?? null;
  }

  updateConversationMeta(id: string, patch: Partial<Pick<ConversationMeta, "title" | "updatedAt" | "sdkSessionId">>): ConversationMeta | null {
    const convs = this.readConvIndex();
    const idx = convs.findIndex(c => c.id === id);
    if (idx === -1) return null;
    convs[idx] = { ...convs[idx], ...patch };
    this.writeConvIndex(convs);
    return convs[idx];
  }

  deleteConversation(id: string): void {
    const convs = this.readConvIndex().filter(c => c.id !== id);
    this.writeConvIndex(convs);
    const msgPath = path.join(this.convDir, `${id}.jsonl`);
    if (fs.existsSync(msgPath)) fs.unlinkSync(msgPath);
  }

  appendConversationMessage(convId: string, msg: ChatMessage): void {
    const msgPath = path.join(this.convDir, `${convId}.jsonl`);
    const line = JSON.stringify(msg) + "\n";
    fs.appendFileSync(msgPath, line);
    this.updateConversationMeta(convId, { updatedAt: Date.now() });
  }

  getConversationMessages(convId: string): ChatMessage[] {
    const msgPath = path.join(this.convDir, `${convId}.jsonl`);
    if (!fs.existsSync(msgPath)) return [];
    const raw = fs.readFileSync(msgPath, "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").map(line => JSON.parse(line) as ChatMessage);
  }
}

interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sdkSessionId?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
}
