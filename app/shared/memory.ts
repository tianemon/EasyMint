/** Memory contracts shared by the host, tools and settings. */
export const MEMORY_KINDS = ["background", "preference", "attention", "activity", "decision", "lesson"] as const;
export type MemoryKind = typeof MEMORY_KINDS[number];
export type MemoryConfidence = "confirmed" | "unconfirmed";
export type MemoryLifecycle = "active" | "archived";
export type MemoryMode = "record" | "use" | "off";
export const MEMORY_TEXT_LIMIT = 600;
export const MEMORY_DETAILS_LIMIT = 2000;
export const MEMORY_SUMMARY_LIMIT = 160;
export interface MemorySource {
  ref: string;
  type: "session" | "manual";
  sessionId?: string;
  entryId?: string;
  hash?: string;
  anchorRef?: string;
  anchorRefs?:string[];
  evidenceEntryId?:string;
  sessionFile?:string;
  messageEntryIds?:string[];
  userEntryIds?:string[];
  timezone?: string;
  quote?: string;
  role?: "user" | "assistant";
  deleted?: boolean;
  projectId?: string;
  submissionId?:string;
  ownerSessionId?:string;
  ownerEntryId?:string;
  ownerHash?:string;
  delegationId?:string;
  taskIndex?:number;
  evidence?:Array<{entryId:string;hash:string}>;
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
  confidence: MemoryConfidence;
  lifecycle: MemoryLifecycle;
  revision: number;
  createdAt: number;
  updatedAt: number;
  occurredAt: number;
  memoryDate?:string;
  timeBasis?: "occurred" | "recorded";
  substantiveAt: number;
  expiresAt?: number;
  archivedAt?: number;
  pinned: boolean;
  importance: "normal" | "high";
  sources: MemorySource[];
  reason?: string;
  invalidatedAt?: number;
  summary?: string;
  effectiveAt?: number;
  pending?: {at:number;bodyFile?:string;bodyKey?:string;patch:Partial<MemoryWrite> & {confidence?:MemoryConfidence;lifecycle?:MemoryLifecycle;sources?:MemorySource[];reason?:string};evidenceAt:number};
}
export type MemorySummary = Omit<MemoryRecord, "details" | "sources" | "pending"> & { matchedRevision?:number; projectName?:string;pendingAt?:number; sources: MemorySource[] };
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
  family?:"memory"|"experience";
  query?: string;
  projectId?: string;
  scope?: "global" | "project" | "both" | "recent";
  confidence?: MemoryConfidence | "all";
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
  enabledAt?: number;
}
export const DEFAULT_MEMORY_SETTINGS: MemorySettings = { enabled: true, background: true };
export function parseMemorySettings(raw: unknown): MemorySettings {
  // 配置"缺失"与"损坏"必须区分：缺失用产品默认（开启），损坏则失败关闭——
  // 否则一个被写坏的字段会让后台分析（调用模型、外发上下文）自动打开。
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw)))
    return { enabled: false, background: false };
  const r = raw && typeof raw === "object" ? raw as Partial<MemorySettings> : {};
  if ((r.enabled !== undefined && typeof r.enabled !== "boolean") ||
      (r.background !== undefined && typeof r.background !== "boolean") ||
      (r.enabledAt !== undefined && (typeof r.enabledAt !== "number" || !Number.isFinite(r.enabledAt))))
    return { enabled: false, background: false };
  // 未配置时按默认开启；只有显式写 false 才算关闭。
  const enabled = typeof r.enabled === "boolean" ? r.enabled : DEFAULT_MEMORY_SETTINGS.enabled;
  const background = typeof r.background === "boolean" ? r.background : DEFAULT_MEMORY_SETTINGS.background;
  return { enabled,
    background,
    ...(typeof r.enabledAt === "number" && Number.isFinite(r.enabledAt) ? { enabledAt: r.enabledAt } : {}) };
}
export interface MemoryExecutionSource {
  permissionSessionId:string;ownerEntryId:string;ownerHash:string;ownerMessageEntryId:string;ownerSessionFile:string;
  delegationId?:string;taskIndex?:number;
}
export interface MemoryConclusion {
  execution?:MemoryExecutionSource;
  toolEntryIds?:string[];
  ref: string;
  sessionId: string;
  entryId: string;
  messageEntryIds?:string[];
  userEntryIds?:string[];
  sessionFile: string;
  projectId?: string;
  projectPath: string;
  timestamp: number;
  hash: string;
  version?:number;
  anchorRef?: string;
  timezone?: string;
}
export type MemoryInitPhase = "idle" | "opening" | "ready" | "error";
export interface MemoryStatus {
  /** 首次上线的持久捕获边界，不随重启或开关变化倒退。 */
  recordingStartedAt?:number;
  failed?:number;
  lastError?:string;
  count: number;
  pending: number;
  usedTokens: number;
  error?: string;
  countKnown?:boolean;
}

export interface MemoryDocument {file:string;content:string;hash:string}
export interface MemoryView { settings:MemorySettings; status:MemoryStatus; projectId?:string; ready?:boolean; }
export interface MemoryApi {
  onChanged(callback:(settings?:MemorySettings,session?:{sessionId:string;mode:MemoryMode})=>void):()=>void;
  state(projectPath?:string):Promise<MemoryView>;
  configure(patch:Partial<Pick<MemorySettings,"enabled"|"background">>):Promise<MemorySettings>;
  readDocument():Promise<MemoryDocument>;
  sessionMode(sessionId:string,mode?:MemoryMode):Promise<MemoryMode>;
}
