/**
 * 取数层：把"从哪读"收在一处，避免每个调用点各自拼路径。
 *
 * - 开发记录：按固定候选顺序找，找不到就用证据降级（由 deliverables 决定）
 * - 本机：现场采集 + 进程内缓存，**不落盘**（落盘就会和 `本机环境.md` 双写）
 */
import type { MachineProbe, MachineProfile } from "./machine-profile";
import { collectMachineProfile, machineChanged, renderMachineSection } from "./machine-profile";

/** 顺序即优先级；命中第一个存在的就停。 */
export const DEVELOP_LOG_CANDIDATES = [
  "开发记录.md",
  "private_docs/开发记录.md",
  "docs/开发记录.md",
  ".easymint/开发记录.md",
] as const;

export interface FileProbe {
  readFile(file: string): string | null;
}

export function findDevelopLogFile(projectPath: string, probe: FileProbe): string | null {
  const base = projectPath.replace(/[/\\]+$/u, "");
  for (const name of DEVELOP_LOG_CANDIDATES) {
    const file = `${base}/${name}`;
    if (probe.readFile(file) !== null) return file;
  }
  return null;
}

export function readDevelopLog(projectPath: string, probe: FileProbe): string | null {
  const file = findDevelopLogFile(projectPath, probe);
  return file ? probe.readFile(file) : null;
}

export interface MachineSnapshot {
  fingerprint: string;
  section: string;
}

export interface MachineCache {
  snapshot?: MachineSnapshot;
  at: number;
}

/** 5 分钟：够覆盖一场会话的开场，又不会让工具升级后长期看不到。 */
export const MACHINE_CACHE_MS = 5 * 60_000;

/**
 * 本机档案：进程内缓存，指纹未变直接复用。
 * 缓存只在内存里，应用重启即重新采集，不产生第二份文件。
 */
export function machineSnapshot(
  probe: MachineProbe,
  cache: MachineCache,
  now = Date.now(),
): { snapshot: MachineSnapshot; cache: MachineCache; collected: boolean } {
  if (cache.snapshot && now - cache.at < MACHINE_CACHE_MS) {
    return { snapshot: cache.snapshot, cache, collected: false };
  }
  const profile: MachineProfile = collectMachineProfile(probe);
  if (cache.snapshot && !machineChanged(cache.snapshot.fingerprint, profile)) {
    return { snapshot: cache.snapshot, cache: { snapshot: cache.snapshot, at: now }, collected: false };
  }
  const snapshot: MachineSnapshot = {
    fingerprint: profile.fingerprint,
    section: renderMachineSection(profile),
  };
  return { snapshot, cache: { snapshot, at: now }, collected: true };
}
