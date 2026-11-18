
export interface MemoryDelivery { items:Array<{key:string;revision:number|string}>; tokens:number; summaryHash?:string }
export interface MemoryVisibility { delivered:Map<string,number|string>; used:number; summaryHash?:string }
export const MEMORY_OUTPUT_LIMIT=1_500;
export const MEMORY_PHASE_LIMIT=4_000;
export function estimateMemoryTokens(text:string):number { return Math.ceil(Buffer.byteLength(text,"utf8")/3); }
export function memoryVisibility(entries:unknown[]):MemoryVisibility {
  const delivered=new Map<string,number|string>(); let used=0,summaryHash:string|undefined;
  const consume=(data:any)=>{
    const delivery=data?.memoryDelivery as MemoryDelivery|undefined;
    if (!delivery || !Array.isArray(delivery.items) || !Number.isFinite(delivery.tokens)) return;
    used+=Math.max(0,delivery.tokens);if(delivery.summaryHash)summaryHash=delivery.summaryHash;
    for (const item of delivery.items) if(typeof item.key==='string' && (Number.isInteger(item.revision)||typeof item.revision==='string')) delivered.set(item.key,item.revision);
  };
  for (const entry of entries as any[]) {
    // Actual SDK projection wraps sourceEntry and zero-or-more edited messages.
    if (entry.sourceEntry?.type==='custom_message' && entry.messages?.length) consume(entry.sourceEntry.details);
    for (const message of entry.messages ?? []) if(message.role==='toolResult') consume(message.details);
  }
  return {delivered,used,summaryHash};
}
export function memoryAllowance(_visibility:MemoryVisibility,usage?:{tokens?:number|null;contextWindow:number},_maintenance=false,maximum=MEMORY_OUTPUT_LIMIT):number {
  let limit=maximum;
  if(usage){if(typeof usage.tokens!=="number")return 0;limit=Math.min(limit,Math.max(0,usage.contextWindow-usage.tokens-Math.min(4000,Math.floor(usage.contextWindow/3))));}
  return limit;
}
