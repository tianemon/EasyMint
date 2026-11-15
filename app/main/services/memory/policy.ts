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
