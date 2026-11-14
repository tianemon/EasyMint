import type { MemoryRecord } from "../../../shared/memory";

export type LifecycleSnapshot = Pick<MemoryRecord, "key"|"pinned"|"state"|"lifecycle"|"createdAt"|"substantiveAt"|"importance"|"expiresAt"|"lowSince"|"archivedAt"|"reason">;

const DAY = 86_400_000;
/** Conservative starting values: ordinary items cool after months, not a few failed searches. */
export const MEMORY_POLICY = { grace: 30 * DAY, normalHalfLife: 90 * DAY, highHalfLife: 270 * DAY,
  archiveScore: 0.35, observation: 30 * DAY, retireAfter: 180 * DAY } as const;
export function retentionScore(item: Pick<MemoryRecord,"substantiveAt"|"importance">, now: number): number {
  const age = Math.max(0, now - item.substantiveAt);
  return Math.pow(0.5, age / (item.importance === "high" ? MEMORY_POLICY.highHalfLife : MEMORY_POLICY.normalHalfLife));
}
export function evaluateLifecycle(item: LifecycleSnapshot, now: number): LifecycleSnapshot | null {
  if (item.pinned || item.state === "rejected" || item.lifecycle === "retired") return null;
  if (now - item.createdAt < MEMORY_POLICY.grace) return null;
  const expired = item.expiresAt !== undefined && item.expiresAt <= now;
  if (expired && item.lifecycle === "active") return { ...item, lifecycle: "archived", archivedAt: now, lowSince: now, reason: "关注条件已到期" };
  const low = retentionScore(item, now) < MEMORY_POLICY.archiveScore;
  if (!low) return item.lowSince === undefined ? null : { ...item, lowSince: undefined };
  if (item.lowSince === undefined) return { ...item, lowSince: now };
  if (item.lifecycle === "active" && now - item.lowSince >= MEMORY_POLICY.observation) {
    return { ...item, lifecycle: "archived", archivedAt: now, reason: "持续低于保留阈值，日常仅保留短正文" };
  }
  if (item.lifecycle === "archived" && now - Math.max(item.archivedAt ?? now, item.substantiveAt) >= MEMORY_POLICY.retireAfter) {
    return { ...item, lifecycle: "retired", reason: "归档后长期无新的确认或实质更新，仅保留历史" };
  }
  return null;
}
/** Index Chinese bigrams explicitly; unicode61 alone doesn't split unspaced Chinese. */
export function memoryTokens(text: string, limit = Number.POSITIVE_INFINITY): string[] {
  const latin = text.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const out: string[] = [];
  for (const word of latin) {
    if (/\p{Script=Han}/u.test(word)) {
      for (const run of word.match(/[\p{Script=Han}]+/gu) ?? []) {
        const chars = [...run];
        for (let i = 0; i < chars.length; i++) { out.push(chars[i]!); if (i + 1 < chars.length) out.push(chars[i]! + chars[i + 1]!); }
      }
      for (const run of word.match(/[a-z0-9_-]+/g) ?? []) out.push(run);
    } else out.push(word);
    if (out.length >= limit) break;
  }
  return [...new Set(out)].slice(0, limit);
}

/** Conservative recognition of explicit stable statements; no model-supplied pin flag. */
export function explicitLongTerm(kind:string,quote:string|undefined):boolean {
  if(!quote) return false;
  const value=quote.trim();
  if(/^(请|务必|帮我)?[，,\s]*(长期|永久)(记住|保存|保留)/u.test(value) || /^(please )?remember (this )?(permanently|long term)/iu.test(value)) return true;
  if(kind==="background") return /^(我叫|我的名字是|我的研究方向(是|为)|我的职业(是|为)|my (name|research focus|profession) is)/iu.test(value);
  if(kind==="preference") return /^(我(一直|通常|平时)(喜欢|偏好|习惯)|以后.{0,20}都|今后.{0,20}都|I (always|usually) prefer)/iu.test(value);
  return false;
}
