/**
 * 把四类信息装配成"可增量交付"的条目，交给 context-plan 决定本轮要不要注入。
 *
 * 收敛后的取数口径（每类只有一个来源）：
 * - 近期事实：调用方已经按范围和资格筛选的主 MEMORY.md 条目；深层/经验另按需读
 * - 项目进展：开发记录（现解析）；无开发记录时退回 git/文件证据，零模型调用
 * - 本机：现场采集 + 进程缓存，由调用方传入
 * - 称呼/人设：归协作设置，**不在这里**，避免两份人设互相覆盖
 */
import {hashText} from "./codec";
import type {MemoryRecord} from "../../../shared/memory";
import type { Deliverable } from "./context-plan";
import { latestRecordDate, parseDevelopLog, renderProjectSection } from "./develop-log";
import { entryRevision, parseEntries } from "./memory-entries";
import { describeEvidence, type ProjectEvidence } from "./project-evidence";
import { renderSessionFallback, worthRemembering, type SessionDigest } from "./session-digest";

export interface DeliverableInput {
  /** 已按范围/资格筛选的主 MEMORY.md；不可传用户界面的原始全文，缺文件传 null。 */
  memory?: string | null;
  projectName?: string;
  /** 项目内 `开发记录.md` 全文；不存在传 null。 */
  developLog?: string | null;
  /** 无开发记录时的降级证据。 */
  evidence?: ProjectEvidence;
  /** git 最后提交日（YYYY-MM-DD），用于标注"记录落后"。 */
  gitLastCommitDate?: string;
  gitCommitsSince?: number;
  /** 本机档案；由调用方采集并缓存，指纹作为版本号。 */
  machine?: { fingerprint: string; section: string } | null;
  /** 三源降级的最后一级：最近一场会话的路标。 */
  session?: SessionDigest;
  /** 跨工具感知的一句话（aab 内部化版），只做路标。 */
  toolHint?: string;
  recentProjects?:string;
}

export const KEY_RULES = "global.rules";
export const KEY_PROGRESS = "project.progress";
export const KEY_MACHINE = "machine";

export function recordDeliveryRevision(item:Pick<MemoryRecord,"text"|"details"|"summary"|"memoryDate">):string {return indexedDeliveryRevision(hashText(JSON.stringify([item.text,item.details ?? null,item.summary ?? null])),item.memoryDate);}
export function indexedDeliveryRevision(bodyHash:string,memoryDate?:string):string {return entryRevision(`${bodyHash}|${memoryDate ?? ""}`);}
export function memoryDeliverables(memory:string|null|undefined):Deliverable[] {
 return parseEntries(memory ?? "").filter(entry=>!entry.pending).map(entry=>({key:`memory:${entry.key}`,revision:entryRevision(JSON.stringify([entry.text,entry.details ?? null,entry.memoryDate ?? null])),text:`记忆[memory:${entry.key}]${entry.memoryDate?`（${entry.memoryDate}）`:""}：${entry.text}${entry.details?`\n${entry.details}`:""}`,priority:1}));
}
export function rulesDeliverable(memory:string|null|undefined):Deliverable|undefined {
 const items=memoryDeliverables(memory);if(!items.length)return;
 const text=items.map(item=>item.text).join("\n");return {key:KEY_RULES,revision:entryRevision(text),text,priority:1};
}

export function progressDeliverable(input: DeliverableInput): Deliverable | undefined {
  const name = input.projectName?.trim() || "当前项目";

  const log = parseDevelopLog(input.developLog ?? "");
  if (log.snapshot.length || log.index.length) {
    const text = renderProjectSection(log, {
      gitLastCommitDate: input.gitLastCommitDate,
      gitCommitsSince: input.gitCommitsSince,
    });
    if (!text) return undefined;
    return {
      key: KEY_PROGRESS,
      revision: entryRevision(text),
      text: `项目 ${name}（来源：项目开发记录，截至 ${latestRecordDate(log) ?? "未知"}）：\n${text}`,
      priority: 2,
    };
  }
  if (input.session && worthRemembering(input.session)) {
    const text = renderSessionFallback(input.session);
    if (text) {
      return {
        key: KEY_PROGRESS,
        revision: entryRevision(text),
        text: `项目 ${name}（无开发记录，来源：最近一场会话的路标）：\n${text}`,
        priority: 2,
      };
    }
  }
  if (input.evidence?.hasContent) {
    const text = describeEvidence(input.evidence);
    return {
      key: KEY_PROGRESS,
      revision: entryRevision(text),
      text: `项目 ${name}（该目录无开发记录，以下为仓库事实）：\n${text}`,
      priority: 2,
    };
  }
  return undefined;
}

export function machineDeliverable(machine: DeliverableInput["machine"]): Deliverable | undefined {
  if (!machine?.section.trim()) return undefined;
  return {
    key: KEY_MACHINE,
    revision: entryRevision(machine.fingerprint),
    text: `本机：\n${machine.section}`,
    priority: 3,
  };
}

export function buildDeliverables(input:DeliverableInput):Deliverable[] {
 const result=memoryDeliverables(input.memory);
 const progress=progressDeliverable(input),machine=machineDeliverable(input.machine);
 if(progress)result.push(progress);if(machine)result.push(machine);
 if(input.toolHint)result.push({key:"runtime:other_sessions",revision:entryRevision(input.toolHint),text:input.toolHint,priority:4});
 if(input.recentProjects)result.push({key:"runtime:recent_projects",revision:entryRevision(input.recentProjects),text:input.recentProjects,priority:3});
 return result;
}
