import { estimateMemoryTokens } from "./context";
import { memoryTokens } from "./policy";

export interface ConclusionPart { text:string; fragmented:boolean }
/** Keep paragraphs together where possible; exceptionally large paragraphs are explicitly marked partial. */
export function conclusionParts(text:string,maxTokens=2_500):ConclusionPart[] {
  const paragraphs=text.match(/[^\n]*(?:\n(?!\s*\n)[^\n]*)*(?:\n\s*\n|$)/gu)?.filter(Boolean) ?? [text];
  const result:ConclusionPart[]=[]; let current="";
  for(const paragraph of paragraphs) {
    if(estimateMemoryTokens(paragraph)>maxTokens) {
      if(current) {result.push({text:current,fragmented:false});current="";}
      const chars=[...paragraph];let start=0;
      while(start<chars.length) {
        let end=Math.min(chars.length,start+maxTokens);
        while(end>start+1 && estimateMemoryTokens(chars.slice(start,end).join(""))>maxTokens) end=start+Math.floor((end-start)*0.8);
        result.push({text:chars.slice(start,end).join(""),fragmented:true});start=end;
      }
    } else if(estimateMemoryTokens(current+paragraph)>maxTokens) {result.push({text:current,fragmented:false});current=paragraph;}
    else current+=paragraph;
  }
  if(current)result.push({text:current,fragmented:false});
  return result.length?result:[{text:"",fragmented:false}];
}
export function selectUserEvidence(text:string,topic:string,maxTokens=1_500):{text:string;partial:boolean} {
  if(estimateMemoryTokens(text)<=maxTokens)return {text,partial:false};
  const terms=new Set(memoryTokens(topic,100));
  const parts=conclusionParts(text,maxTokens).map((part,index)=>({...part,index,score:memoryTokens(part.text,300).filter(t=>terms.has(t)).length}));
  const selected:typeof parts=[];let used=0;
  for(const part of parts.slice().sort((a,b)=>b.score-a.score||b.index-a.index)) {
    const cost=estimateMemoryTokens(part.text);if(used+cost>maxTokens)continue;
    selected.push(part);used+=cost;
  }
  return {text:selected.sort((a,b)=>a.index-b.index).map(part=>part.text).join("\n\n"),partial:true};
}
