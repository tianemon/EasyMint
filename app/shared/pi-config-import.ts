export interface PiImportSummary {
  sourceDir: string;
  found: boolean;
  providers: number;
  sessions: number;
  projects: number;
  conflicts: number;
  duplicates: number;
  invalidSessions: number;
  providerConflictSessions: number;
  oauth: boolean;
  skippedSettings: string[];
  backup?: string;
}
