/** 仅保护这两个既有授权入口，不承担完整自然语言权限解析。
 * 保留完整相关子句，防止截短引文将否定变成许可。 */
const FORGET=/(忘记|忘掉|别记|不要再记|删除.*记忆|清除.*记忆|forget|remove.*memor)/iu;
const NEGATIVE=/(不要|别|不能|禁止|不允许|不准|不用|不必|先不|暂不|勿|不(?:读|看|访问|搜索|检索|修改|编辑|写入|保存|删除|清除))|\b(do not|don't|never|must not|not now)\b/iu;
const HYPOTHETICAL=/(假设|如果|举例|例如|仅.{0,4}引用|只是.{0,4}引用|转述|怎么|如何)|\b(example|suppose|hypothetical|what if|how to)\b/iu;
const OBJECT_VERB=/(忘记|忘掉|别记|不要再记|读取|查看|打开|访问|搜索|检索|修改|编辑|更新|更正|保存|记住|forget|read|view|open|search|update|save)\s*$/iu;
const ACTION=/(忘记|忘掉|别记|不要再记|删除|清除|读取|查看|访问|搜索|检索|修改|编辑|更新|更正|保存|记住|处理|检查|标记|失效|归档|恢复|整理|取消)|\b(forget|remove|read|view|access|search|update|save|edit|archive|restore|inspect)\b/iu;
function denied(text:string):boolean {return NEGATIVE.test(text.replace(/不要再记|别记/gu,""));}
function clauses(user:string,trustedSelection:boolean):Array<{text:string;start:number;end:number;sentence:string}> {
 const direct=trustedSelection?user:user.replace(/```[\s\S]*?```|^\s*>[^\n]*$|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|`[^`\n]*`|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gmu,(quoted:string,offset:number)=>{
  // 直接命令可引用项目名等对象；纯命令引文不授权。可信问答的答案允许JSON格式。
  const body=quoted.slice(1,-1);if(!quoted.startsWith("```")&&OBJECT_VERB.test(user.slice(0,offset))&&!ACTION.test(body))return quoted;
  return " ".repeat(quoted.length);
 });
 const result:Array<{text:string;start:number;end:number;sentence:string}>=[];
 for(const sentence of direct.matchAll(/[^。!?？！；;\n]+/gu)){
  if(HYPOTHETICAL.test(sentence[0]))continue;
  for(const clause of sentence[0].matchAll(/[^，,]+/gu)){const start=sentence.index!+clause.index!;result.push({text:clause[0],start,end:start+clause[0].length,sentence:sentence[0]});}
 }
 return result;
}
export function forgetConsent(user:string,quote:string|undefined,trustedSelection=false):boolean {
 if(!quote?.trim()||!FORGET.test(quote))return false;
 const candidates=clauses(user,trustedSelection);let from=0,index:number;
 while((index=user.indexOf(quote,from))!==-1){
  const relevant=candidates.filter(clause=>clause.start<index+quote.length&&clause.end>index);
  if(relevant.length&&relevant.every(clause=>!denied(clause.text))&&relevant.some(clause=>FORGET.test(clause.text)))return true;
  from=index+quote.length;
 }
 return false;
}
export function projectConsent(user:string,names:string[],trustedSelection=false,otherNames:string[]=[]):boolean {
 // 项目名是原样标签；名称恰为Example也不能被当成假设关键词。
 let marker="\uE000";while(user.includes(marker))marker+="\uE000";
 let other="\uE001";while(user.includes(other))other+="\uE001";
 const named=otherNames.filter(Boolean).reduce((text,name)=>text.split(name).join(other),names.filter(Boolean).reduce((text,name)=>text.split(name).join(marker),user)),parts=clauses(named,trustedSelection);
 if(parts.some(clause=>{const only=/(?:只(?!要)|仅|\bonly\b)/iu.exec(clause.text);if(!only)return false;const tail=clause.text.slice(only.index);return tail.includes(other)&&!tail.includes(marker);}))return false;
 return parts.some(clause=>!denied(clause.text)&&!/(只是背景|仅作背景|作为背景|仅供参考|just.{0,8}background|background only)/iu.test(clause.text)&&((clause.text.includes(marker)&&ACTION.test(clause.sentence))||/跨项目|所有项目|其他项目|all projects|across projects/iu.test(clause.text)));
}
/** 只有实际答案可提供许可。短肯定仅绑定本次对应问题；否定和含糊答案不借用问题正文。 */
export function selectionConsent(value:unknown):string {
 if(!Array.isArray(value))return "";
 return value.filter((item):item is {question:string;answer:string}=>Boolean(item&&typeof item.question==="string"&&typeof item.answer==="string")).map(item=>{
  if(denied(item.answer)||/^\s*(否|不愿意|不同意|拒绝|no\b)/iu.test(item.answer))return "";
  const positive=/^(是|是的|同意|确认|允许|好的|yes|ok|confirm|allow)[!！。.\s]*(?:\([^\n()]*\))?$/iu.test(item.answer.trim());
  return positive?`${item.question}\n${item.answer}`:item.answer;
 }).join("\n\n");
}
