import { describe, expect, it } from 'vitest';
import { assistantSegments } from './chat-message-presentation';
import { buildFinalAnswerEntries } from './chat-turn-presentation';
import type { ChatMessage } from './chat-utils';
import type { StreamEntry } from './StreamPanel';
const text = (value:string,phase?:'commentary'|'final_answer'):StreamEntry => ({kind:'text',text:value,phase,timestamp:0});
const ai = (id:number,entries:StreamEntry[],patch:Partial<ChatMessage>={}):ChatMessage => ({id,role:'ai',timestamp:id,entries,stopReason:'stop',...patch});

describe('conclusion action eligibility',()=>{
  it('allows a plain terminal answer without requiring a foldable execution record',()=>{
    const entries=[text('answer')], messages=[ai(1,entries)];
    expect(buildFinalAnswerEntries(messages,false).get(0)).toEqual(entries);
    expect(buildFinalAnswerEntries(messages,true).size).toBe(0);
  });
  it('does not attach final actions to thought, tool or preamble-only messages',()=>{
    const process:StreamEntry[]=[{kind:'thinking',text:'reasoning',timestamp:0},
      {kind:'tool_use',id:'read',name:'read',input:{path:'x'},collapsed:true,timestamp:0},
      {kind:'tool_result',toolUseId:'read',content:'x',isError:false,timestamp:0}];
    const messages=[ai(1,[text('checking','commentary')]),ai(2,process),ai(3,[text('answer')])];
    expect([...buildFinalAnswerEntries(messages,false).keys()]).toEqual([2]);
  });
  it('preserves explicit final text in a mixed message without copying the commentary',()=>{
    const entries=[text('checking','commentary'),text('answer','final_answer')];
    const before=structuredClone(entries);
    const chosen=buildFinalAnswerEntries([ai(1,entries)],false).get(0)!;
    expect(chosen).toEqual([entries[1]]);
    expect(assistantSegments(entries,chosen).map(s=>[s.conclusion,s.entries])).toEqual([[false,[entries[0]]],[true,[entries[1]]]]);
    expect(entries).toEqual(before);
  });
  it.each([{stopReason:'aborted'}, {turnOutcome:'cancelled'}, {stopReason:'error'}, {stopReason:undefined}] as Partial<ChatMessage>[])('does not present a partial or uncertain ending as a conclusion (%j)',patch=>{
    expect(buildFinalAnswerEntries([ai(1,[text('partial')],patch)],false).size).toBe(0);
  });
  it('keeps earlier answers actionable while the latest run is still streaming',()=>{
    const question:ChatMessage={id:3,role:'user',text:'next',timestamp:3};
    expect([...buildFinalAnswerEntries([ai(1,[text('answer')]),question,ai(4,[text('partial')],{streaming:true})],true).keys()]).toEqual([0]);
  });
  it('keeps tool associations, source identities and segment ordering intact around final text',()=>{
    const call:StreamEntry={kind:'tool_use',id:'x',name:'read',input:{path:'x'},collapsed:true,timestamp:0};
    const result:StreamEntry={kind:'tool_result',toolUseId:'x',content:'x',isError:false,timestamp:0};
    const answer=text('answer','final_answer'),comment=text('follow-up','commentary');
    const entries=[call,result,answer,comment],parts=assistantSegments(entries,[answer]);
    expect(parts.flatMap(p=>p.entries)).toEqual(entries);
    expect(parts[0]!.entries[0]).toBe(call);expect(parts[0]!.entries[1]).toBe(result);
    expect(parts.map(p=>p.conclusion)).toEqual([false,true,false]);
  });
});
