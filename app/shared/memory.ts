/** Memory contracts shared by the host, tools and settings. */
export const MEMORY_KINDS = ["background", "preference", "attention", "activity", "decision", "lesson"] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];
export type MemoryState = "confirmed" | "candidate" | "rejected";
export type MemoryLifecycle = "active" | "archived" | "retired";
export type MemoryMode = "record" | "use" | "off";
export const MEMORY_TEXT_LIMIT = 600;
export const MEMORY_DETAILS_LIMIT = 2000;
export const MEMORY_SUMMARY_LIMIT = 160;
export interface MemorySource {
  ref: string;
  type: "session" | "manual" | "legacy";
  sessionId?: string;
  entryId?: string;
  hash?: string;
  anchorRef?: string;
  timezone?: string;
  quote?: string;
  role?: "user" | "assistant";
  deleted?: boolean;
  projectId?: string;
}
export interface MemoryRecord {
  key: string;
  id: string;
  scope: "global" | "project";
  projectId?: string;
  kind: MemoryKind;
  text: string;
  details?: string;
  tags: string[];
  state: MemoryState;
  lifecycle: MemoryLifecycle;
  revision: number;
  createdAt: number;
  updatedAt: number;
  occurredAt: number;
  timeBasis?: "occurred" | "recorded";
  substantiveAt: number;
  expiresAt?: number;
  archivedAt?: number;
  lowSince?: number;
  pinned: boolean;
  importance: "normal" | "high";
  sources: MemorySource[];
  reason?: string;
  invalidatedAt?: number;
  summary?: string;
  mergedInto?: string;
  effectiveAt?: number;
  pending?: {at:number;patch:Partial<MemoryWrite> & {state?:MemoryState;lifecycle?:MemoryLifecycle;sources?:MemorySource[];reason?:string};evidenceAt:number};
  legacy?: Record<string, unknown>;
}
export type MemorySummary = Omit<MemoryRecord, "details" | "sources" | "legacy" | "pending"> & { matchedRevision?:number; projectName?:string;pendingAt?:number; sources: Array<Pick<MemorySource, "ref" | "sessionId" | "entryId" | "hash" | "deleted" | "type">> };
export interface MemoryWrite {
  kind: MemoryKind;
  text: string;
  details?: string;
  tags?: string[];
  occurredAt?: number;
  expiresAt?: number | null;
  importance?: "normal" | "high";
  summary?: string;
  effectiveAt?: number | null;
}
export interface MemoryQuery {
  query?: string;
  projectId?: string;
  scope?: "global" | "project" | "both" | "recent";
  state?: MemoryState | "all";
  lifecycle?: MemoryLifecycle | "all";
  history?: boolean;
  view?: "current" | "history" | "all";
  kind?: MemoryKind;
  from?: number;
  to?: number;
  offset?: number;
  limit?: number;
}
export interface MemoryPage { items: MemorySummary[]; total: number; next?: number }
export interface MemorySettings {
  enabled: boolean;
  background: boolean;
  dailyTokens: number;
  enabledAt?: number;
}
export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { enabled: false, background: false, dailyTokens: 30_000 };
export function parseMemorySettings(raw: unknown, legacyEnabled = false): MemorySettings {
  const r = raw && typeof raw === "object" ? raw as Partial<MemorySettings> : {};
  return { enabled: typeof r.enabled === "boolean" ? r.enabled : raw === undefined && legacyEnabled,
    background: typeof r.enabled === "boolean" && r.background === true,
    dailyTokens: Number.isFinite(r.dailyTokens) ? Math.min(1_000_000, Math.max(1_000, Math.round(r.dailyTokens!))) : DEFAULT_MEMORY_SETTINGS.dailyTokens,
    ...(typeof r.enabledAt === "number" && Number.isFinite(r.enabledAt) ? { enabledAt: r.enabledAt } : {}) };
}
export interface MemoryConclusion {
  ref: string;
  sessionId: string;
  entryId: string;
  sessionFile: string;
  projectId?: string;
  projectPath: string;
  timestamp: number;
  hash: string;
  version?:number;
  anchorRef?: string;
  timezone?: string;
}
export interface MemoryMigrationReport {
  directory: string;
  backup: string;
  imported: number;
  unchanged: number;
  conflicts: number;
  missing: string[];
  errors: string[];
  projectId?: string;
  projectName?: string;
  projectPath?: string;
  status?: "complete" | "attention" | "failed";
  documentError?:string;
}
export interface MemoryMigrationProgress {
  phase:"idle"|"opening"|"migrating"|"ready"|"error";
  completed:number;
  total:number;
  projectName?:string;
}
export interface MemoryStatus {
  failed?:number;
  lastError?:string;
  count: number;
  pending: number;
  usedTokens: number;
  error?: string;
  countKnown?:boolean;
}
export interface MemoryDocumentConfig { projectId: string; directory: string; revision: number; error?: string }

export interface MemoryDocumentView { directory:string;relativeDirectory?:string;previousStateBackup?:string; legacy?:string; backup?:string; generation:number; error?:string }
export interface MemoryDocumentPreview { directory:string; files:string[]; bytes:number; hash:string }
export interface MemoryDigest { content:string; hash:string; items:Array<{key:string;revision:number}>; file:string; error?:string }
export interface MemoryView { settings:MemorySettings; status:MemoryStatus; reports:MemoryMigrationReport[]; projectId?:string; documents?:MemoryDocumentView; digest?:MemoryDigest; migration?:MemoryMigrationProgress; ready?:boolean;backupDirectory?:string }
export interface MemoryApi {
  onChanged(callback:(settings?:MemorySettings,session?:{sessionId:string;mode:MemoryMode})=>void):()=>void;
  state(projectPath?:string):Promise<MemoryView>;
  configure(patch:Partial<Pick<MemorySettings,"enabled"|"background"|"dailyTokens">>):Promise<MemorySettings>;
  query(query:MemoryQuery & {projectPath?:string}):Promise<MemoryPage>;
  read(key:string,projectPath?:string):Promise<{item?:MemoryRecord;revisions:MemoryRecord[]}>;
  save(input:MemoryWrite & {scope:"global"|"project";projectPath?:string;pinned?:boolean}):Promise<MemoryRecord & {warning?:string}>;
  update(key:string,revision:number,patch:Partial<MemoryWrite> & Pick<Partial<MemoryRecord>,"state"|"lifecycle"|"pinned"> & {cancelPending?:boolean},projectPath?:string):Promise<MemoryRecord & {warning?:string}>;
  forget(key:string,projectPath?:string):Promise<void>;
  analyze():Promise<void>;
  summary(refresh?:boolean):Promise<MemoryDigest>;
  retryMigrations(projectId?:string):Promise<void>;
  openBackups():Promise<void>;
  previewDocuments(projectPath:string,directory?:string):Promise<MemoryDocumentPreview>;
  adoptDocuments(projectPath:string,directory:string,hash:string):Promise<MemoryDocumentView>;
  repairDocuments(projectPath:string,directory:string,hash:string):Promise<MemoryDocumentView>;
  sessionMode(sessionId:string,mode?:MemoryMode):Promise<MemoryMode>;
}
