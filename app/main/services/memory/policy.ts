import {MEMORY_KINDS,MEMORY_TEXT_LIMIT,MEMORY_DETAILS_LIMIT,MEMORY_SUMMARY_LIMIT,type MemoryWrite} from "../../../shared/memory";
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

/** Reject long verbatim excerpts; semantic condensation stays in the single extraction pass. */
export function assertCondensed(input:{text:string;details?:string},evidence:string):void {
  const source=evidence.replace(/\s+/gu,"");
  for(const value of [input.text,input.details ?? ""]){
    const text=value.replace(/\s+/gu,"");
    if(text.length>=180 && source.includes(text))throw new Error("记忆内容近似原文，请只提炼结论和必要条件，并保留来源定位");
  }
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

export function validateMemoryWrite(input:MemoryWrite):void {
    if (!MEMORY_KINDS.includes(input.kind) || typeof input.text !== "string" || !input.text.trim() || input.text.length > MEMORY_TEXT_LIMIT) throw new Error("记忆需提炼为600字符以内的结论；原文请保留来源定位");
    if (input.details !== undefined && (typeof input.details !== "string" || input.details.length > MEMORY_DETAILS_LIMIT)) throw new Error("必要详情限2000字符；不要拆条复制原文，请提炼并保留资料定位");
    if (input.tags && (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(t => typeof t !== "string" || t.length > 100))) throw new Error("记忆标签格式无效");
    if(input.summary!==undefined && (typeof input.summary!=="string" || input.summary.length>MEMORY_SUMMARY_LIMIT))throw new Error("摘要入口限160字符，请概括主题，不放设计细节");
    if(/```|(?:^|\n)\s*(?:Traceback|at \w+\s*\(|diff --git)/u.test(`${input.text}\n${input.details ?? ""}`))throw new Error("记忆只保存凝练结论，不保存代码或日志原文");
    for (const t of [input.occurredAt, input.expiresAt,input.effectiveAt]) if (t != null && (!Number.isFinite(t) || !Number.isFinite(new Date(t).getTime()))) throw new Error("记忆时间无效");
  }
