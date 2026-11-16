/**
 * 把四类信息装配成"可增量交付"的条目，交给 context-plan 决定本轮要不要注入。
 *
 * 收敛后的取数口径（每类只有一个来源）：
 * - 约定：MEMORY.md 条目（本机唯一记忆文件）
 * - 项目进展：开发记录（现解析）；无开发记录时退回 git/文件证据，零模型调用
 * - 本机：现场采集 + 进程缓存，由调用方传入
 * - 称呼/人设：归协作设置，**不在这里**，避免两份人设互相覆盖
 */
import type { Deliverable } from "./context-plan";
import { latestRecordDate, parseDevelopLog, renderProjectSection } from "./develop-log";
import { entryRevision, parseEntries, renderForPrompt } from "./memory-entries";
import { describeEvidence, type ProjectEvidence } from "./project-evidence";
import { renderSessionFallback, worthRemembering, type SessionDigest } from "./session-digest";

export interface DeliverableInput {
  /** MEMORY.md 全文；缺文件传 null。 */
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
}

export const KEY_RULES = "global.rules";
export const KEY_PROGRESS = "project.progress";
export const KEY_MACHINE = "machine";

const RULES_LABEL = "约定（长期有效，与当前请求冲突时以你的明确指令为准）：";

export function rulesDeliverable(memory: string | null | undefined): Deliverable | undefined {
  const source = memory ?? "";
  const entries = parseEntries(source);
  // 非条目文本：标题、说明段落、用户随手写的句子。条目之外的内容一律不丢。
  const prose = source
    .replace(/<!--[\s\S]*?-->/gu, "")
    .split("\n")
    .map((line) => line.replace(/^#+[ \t]*/u, "").trim())
    .filter((line) => line && !/^[-*][ \t]/u.test(line))
    .join("\n")
    .trim();

  const parts: string[] = [];
  if (entries.length) parts.push(renderForPrompt(entries, 400));
  if (prose) parts.push(`其他说明：\n${prose.slice(0, 200)}`);
  const body = parts.join("\n").trim();
  if (!body) return undefined;
  return {
    key: KEY_RULES,
    revision: entryRevision(body),
    text: `${RULES_LABEL}\n${body.slice(0, 600)}`,
    priority: 1,
  };
}

export function progressDeliverable(input: DeliverableInput): Deliverable | undefined {
  const name = input.projectName?.trim() || "当前项目";
  const hint = input.toolHint ? `\n${input.toolHint}` : "";
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
      text: `项目 ${name}（来源：项目开发记录，截至 ${latestRecordDate(log) ?? "未知"}）：\n${text}${hint}`,
      priority: 2,
    };
  }
  if (input.session && worthRemembering(input.session)) {
    const text = renderSessionFallback(input.session);
    if (text) {
      return {
        key: KEY_PROGRESS,
        revision: entryRevision(text),
        text: `项目 ${name}（无开发记录，来源：最近一场会话的路标）：\n${text}${hint}`,
        priority: 2,
      };
    }
  }
  if (input.evidence?.hasContent) {
    const text = describeEvidence(input.evidence);
    return {
      key: KEY_PROGRESS,
      revision: entryRevision(text),
      text: `项目 ${name}（该目录无开发记录，以下为仓库事实）：\n${text}${hint}`,
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

export function buildDeliverables(input: DeliverableInput): Deliverable[] {
  return [rulesDeliverable(input.memory), progressDeliverable(input), machineDeliverable(input.machine)]
    .filter((item): item is Deliverable => Boolean(item));
}
