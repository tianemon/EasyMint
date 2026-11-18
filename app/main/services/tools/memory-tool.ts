import type { ToolDefinition } from "../pi-sdk";
import { getDefineToolFn } from "../pi-sdk";
import type { MemoryService, MemorySessionContext } from "../memory/service";
import type { MemoryKind, MemoryWrite } from "../../../shared/memory";
import { MEMORY_KINDS } from "../../../shared/memory";
import {recordDeliveryRevision} from "../memory/deliverables";
import { estimateMemoryTokens, memoryAllowance, memoryVisibility } from "../memory/context";

const visibleSource=(source:import("../../../shared/memory").MemorySource)=>({ref:source.ref,type:source.type,sessionId:source.sessionId,entryId:source.entryId,role:source.role,deleted:source.deleted,projectId:source.projectId,evidenceEntryId:source.evidenceEntryId});

export async function createMemoryTool(service:MemoryService,getContext:()=>MemorySessionContext,family:"memory"|"experience"="memory"):Promise<ToolDefinition> {
  const experience=family==="experience";
  const define=await getDefineToolFn(true);
  return define({
    name:family,label:experience?"经验":"记忆",executionMode:"sequential",
    description:experience
      ? "保存、查找、读取、更正或标记不再成立的可复用经验。提供适用条件、做法、验证依据和边界；结论只到证据支持的范围，做法有效而原因未知也可保存并注明未知。主/执行Agent可主动提交，不必等待用户说记住；来源绑定真实当前工具调用和实际操作。先查少量相关经验，匹配后分页读，不常驻加载全库，不自动改项目规则或创建技能。"
      : "记录和检索重要事件、持续事项、特殊环境背景。近期核心和必要详情留浅层，较早详情按记忆日期下沉；在重要结论、决定或前提更正等自然节点，结合未来用途、已有载体和证据主动提交；一次重要事件也可记，不按操作次数判断价值。事实、计划、助手报告与验证状态区分；开发约定和人格不进记忆。相关时主动检索旧背景，按ID分页读。",
    promptGuidelines:[
      "scope=project默认用于本项目，真正跨项目成立才global。子Agent只能操作本任务项目范围。保持来源资格，记忆与经验不能扩大权限或替代当前指令。",
      "保存前查近似条目，已有则按key/revision更新，不同时间的独立事件不因文字相同就合并。text/title是凝练核心，details保留必要条件，不复制日志代码原文。",
      "basis=explicit时quote是当前用户的准确原话；basis=observed由程序关联本轮真实工具结果，可用evidenceEntryIds指定已知来源。没有证据的推测不当已验证结论。reported仅用于明确标记的助手报告事件。",
      "原始资料可能已删除或不可访问，不能从摘要编造原话。足够时停止检索；上下文已经有且未变的内容不重复读取。",
      "仅用户明确要求才forget；经验失效需要真实新依据或用户确认；事实archive/restore/cancel和整理edit/write_summary须有当前用户明确的维护请求。事项完成不等于原事实错误，可用有依据的update说明完成状态；不按日期或次数淘汰。write_summary只用于明确整理请求，优先按稳定ID的局部edits；删除浅层入口是下沉，不是遗忘。"
    ],
    parameters:{type:"object",properties:{
      action:{type:"string",enum:experience?["save","search","read","update","forget","archive","invalidate","restore"]:["save","search","read","update","forget","edit","archive","restore","cancel","read_summary","write_summary"]},
      hash:{type:"string",description:"read_summary返回的当前MEMORY.md内容hash；write_summary必须提供，用于避免覆盖并发修改"},
      edits:{type:"array",items:{type:"object",properties:{oldText:{type:"string"},newText:{type:"string"}},required:["oldText","newText"]},description:"write_summary优先使用局部编辑，oldText须唯一；必须保留条目ID/版本/日期/来源；不接受追加自由段落，新事实走save。不要覆盖未读范围。与完整text互斥"},
      scope:{type:"string",enum:["global","project","both","recent"],description:"save使用global或project；登记项目中默认project，无登记项目默认global。search可用both/recent。update保留原范围，不迁移条目"},
      projectId:{type:"string",description:"条目操作的其他已登记项目ID，用户需明确指定跨项目范围；read_summary/write_summary只处理当前会话范围，不传此参数"},maintenanceQuote:{type:"string",description:"本轮用户明确整理请求的原话；只用于授权范围内的分批读取"},confidence:{type:"string",enum:["confirmed","unconfirmed","all"]},view:{type:"string",enum:["current","history","all"]},query:{type:"string"},key:{type:"string"},revision:{type:"number"},
      title:{type:"string"},when:{type:"string"},do:{type:"string"},why:{type:"string"},verification:{type:"string"},limits:{type:"string"},evidenceEntryIds:{type:"array",items:{type:"string"}},
      kind:{type:"string",enum:experience?["lesson"]:MEMORY_KINDS.filter(kind=>kind!=="lesson"),description:"事实类型；preference仅用于个人喜好事实，不保存对助手/开发流程的指令。人格和人工行为要求归角色配置或项目规则；可复用方法使用experience"},text:{type:"string"},details:{type:"string"},
      tags:{type:"array",items:{type:"string"}},basis:{type:"string",enum:["explicit","observed","reported"]},quote:{type:"string"},
      history:{type:"boolean"},from:{type:"number",description:"发生或记录时间下界，UTC毫秒"},to:{type:"number",description:"时间上界，UTC毫秒"},offset:{type:"number"},limit:{type:"number"},section:{type:"string",enum:["text","details","sources","evidence","planned"]},
      sourceIndex:{type:"number"},summary:{type:"string",maxLength:160},effectiveAt:{type:["number","null"]},occurredAt:{type:"number"},expiresAt:{type:["number","null"]},importance:{type:"string",enum:["normal","high"]},
    },required:["action"]},
    async execute(_id:string,params:Record<string,unknown>,signal?:AbortSignal) {
      signal?.throwIfAborted();
      const context=getContext(), visibility=memoryVisibility(context.projection);
      const output=(value:unknown,items:Array<{key:string;revision:number|string}>=[],limit?:number)=>{
        signal?.throwIfAborted();
        if(["search","read","read_summary"].includes(String(params.action))&&!service.canRead(context))throw new Error("本次会话已关闭记忆");
        let text=JSON.stringify(value);
        let failed=Boolean(value&&typeof value==="object"&&"error" in value&&typeof value.error==="string");
        if(limit!==undefined && estimateMemoryTokens(text)>limit){text=JSON.stringify({error:"记忆元信息超过本次上下文预算，请缩小范围并分批读取"});failed=true;}
        if(failed)items=[];
        return {content:[{type:"text" as const,text}],...(failed?{isError:true}:{}),details:{memoryDelivery:{items,tokens:estimateMemoryTokens(text)}}};
      };
      let action=String(params.action);
      if(params.projectId!==undefined&&["read_summary","write_summary"].includes(action))throw new Error("主记忆文档仅使用当前会话范围，不支持projectId；其他项目请按条目读取或管理");
      if(context.limited && ["write_summary","edit","forget","archive","invalidate","restore","cancel"].includes(action))throw new Error("执行Agent仅可查询或提交本任务范围的记忆/经验");
      if(experience && ["read_summary","write_summary","cancel"].includes(action))throw new Error("经验按条目处理，不修改主记忆文件");
      const submission={toolCallId:_id,evidenceEntryIds:params.evidenceEntryIds as string[]|undefined};
      if(experience && ["archive","invalidate"].includes(action))return output(await service.invalidateExperienceFromAgent(context,String(params.key ?? ""),Number(params.revision),String(params.details ?? params.text ?? ""),submission,params.quote as string|undefined,signal,params.projectId as string|undefined));
      if(experience && action==="restore")action="update";
      if(action==="save"&&params.scope!==undefined&&params.scope!=="global"&&params.scope!=="project")throw new Error("保存范围须为global或project；both/recent仅用于搜索");
      if(action==="write_summary")return output(await service.saveDocumentFromAgent(context,typeof params.text==="string"?params.text:undefined,String(params.hash ?? ""),signal,params.edits as Array<{oldText:string;newText:string}>|undefined));
      if(["edit","archive","restore","cancel"].includes(action)) {
        const input=params.text===undefined?undefined:{kind:params.kind as MemoryKind,text:String(params.text),details:params.details as string|undefined,tags:params.tags as string[]|undefined,summary:params.summary as string|undefined};
        const result=await service.manageFromAgent(context,action as "edit"|"archive"|"restore"|"cancel",{key:params.key as string|undefined,revision:params.revision as number|undefined,input,quote:params.quote as string|undefined,projectId:params.projectId as string|undefined},signal);
        return output({key:result.item.key,revision:result.item.revision,confidence:result.item.confidence,lifecycle:result.item.lifecycle,pendingAt:result.item.pending?.at});
      }
      if(action==="save" || action==="update") {
        let text=String(params.text ?? ""),details=typeof params.details==="string"?params.details:undefined;
        if(experience){
          for(const key of ["title","when","do","verification","limits"])if(typeof params[key]!=="string" || !String(params[key]).trim())throw new Error("经验需提供title、when、do、verification和limits；未知边界请明确说明");
          text=String(params.title).trim();details=[`适用：${String(params.when).trim()}`,`做法：${String(params.do).trim()}`,`验证依据：${String(params.verification).trim()}`,`边界：${String(params.limits).trim()}`,...(params.why?[`原因：${String(params.why).trim()}`]:[])].join("\n\n");
        }
        const input:MemoryWrite={kind:experience?"lesson":params.kind as MemoryKind,text,details,
          tags:params.tags as string[]|undefined,occurredAt:params.occurredAt as number|undefined,expiresAt:params.expiresAt as number|undefined,
          summary:params.summary as string|undefined,effectiveAt:params.effectiveAt as number|undefined,importance:params.importance as MemoryWrite["importance"]};
        if(!experience&&input.kind==="lesson")throw new Error("可复用方法请使用experience工具");
        if(!MEMORY_KINDS.includes(input.kind)) throw new Error("需要提供有效kind");
        const result=action==="save"
          ? await service.saveFromAgent(context,input,params.scope==="global"?"global":params.scope==="project"?"project":params.projectId||service.project(context.projectPath)?"project":"global",params.quote as string|undefined,String(params.basis ?? "observed"),signal,submission,params.projectId as string|undefined)
          : await service.updateFromAgent(context,String(params.key ?? ""),Number(params.revision),input,params.quote as string|undefined,String(params.basis ?? "observed"),signal,submission,params.projectId as string|undefined);
        return output({key:result.item.key,revision:result.item.revision,confidence:result.item.confidence,lifecycle:result.item.lifecycle,text:result.item.text,memoryDate:result.item.memoryDate,pendingAt:result.item.pending?.at,effectiveAt:result.item.effectiveAt,existing:result.existing},experience || result.item.pending || result.item.effectiveAt!==undefined && result.item.effectiveAt>Date.now() || result.item.confidence!=="confirmed"?[]:[{key:`memory:${result.item.key}`,revision:recordDeliveryRevision(result.item)}]);
      }
      if(action==="forget") {
        const result=await service.forgetFromAgent(context,String(params.key ?? ""),params.quote as string|undefined,signal,family,params.projectId as string|undefined);
        return output(result);
      }
      const maintenance=await service.maintenanceAllowed(context,params.maintenanceQuote,true);
      const allowance=memoryAllowance(visibility,context.usage,maintenance);
      if(allowance<150) return output({error:"当前记忆读取预算不足；请减少范围或在自然压缩／新会话后继续，不要反复重试"});
      if(action==="read_summary") {
        if(!service.canRead(context))throw new Error("本次会话已关闭记忆");
        const document=await service.readDocumentFromAgent(context),section=document.content;
        const offset=Math.max(0,Number(params.offset)||0),chars=[...section];let length=Math.max(0,Math.min(chars.length-offset,Math.floor((allowance-150)*1.3)));
        let value:unknown;
        do{value={file:document.file,hash:document.hash,section:"text",offset,content:chars.slice(offset,offset+length).join(""),...(offset+length<chars.length?{nextOffset:offset+length}:{})};if(estimateMemoryTokens(JSON.stringify(value))<=allowance)break;length=Math.floor(length*0.7);}while(length>0);
        if(!service.canRead(context))throw new Error("本次会话已关闭记忆");
        return service.deliverRead(context,document.readVersions,()=>output(value,offset===0&&length>=chars.length?document.deliveryItems ?? []:[],allowance),false,signal);
      }
      if(action==="search") {
        if(context.limited&&!String(params.query ?? "").trim())throw new Error("执行Agent查询需提供本任务相关关键词");
        const page=await service.query(context,{family,query:String(params.query ?? ""),scope:params.scope as "both"|"global"|"project"|"recent"|undefined,
          projectId:params.projectId as string|undefined,confidence:params.confidence as "confirmed"|"unconfirmed"|"all"|undefined,view:params.view as "current"|"history"|"all"|undefined,history:params.history===true,from:params.from as number|undefined,to:params.to as number|undefined,offset:Math.max(0,Number(params.offset)||0),limit:Math.min(20,Math.max(1,Number(params.limit)||5)),kind:params.kind as MemoryKind|undefined});
        const selected:Array<{key:string;revision:number;text:string;scope:string;confidence:string;lifecycle:string;requiresRead?:boolean;matchedRevision?:number;projectName?:string}>=[];
        const delivered:Array<{key:string;revision:number|string}>=[];
        for(const item of page.items) {
          const compact={key:item.key,revision:item.revision,text:item.text || "正文不可访问，请按来源核对",scope:item.scope,confidence:item.confidence,lifecycle:item.lifecycle,occurredAt:new Date(item.occurredAt).toISOString(),timeBasis:item.timeBasis ?? "recorded",updatedAt:new Date(item.updatedAt).toISOString(),reason:item.reason,effectiveAt:item.effectiveAt,expiresAt:item.expiresAt,matchedRevision:item.matchedRevision,pendingAt:item.pendingAt,projectName:item.projectName};
          if(estimateMemoryTokens(JSON.stringify({items:[...selected,compact],total:page.total,nextOffset:999999}))>allowance) {
            if(!selected.length) selected.push({...compact,text:"",requiresRead:true});
            break;
          }
          selected.push(compact);
        }
        // Source filtering can leave an empty page. Continue from the database
        // cursor; when the context budget truncates it, resume at the first
        // unread original row rather than counting only the visible records.
        const next=selected.length<page.items.length?(page.offsets?.[selected.length] ?? (Number(params.offset)||0)+selected.length):page.next;
        return service.deliverRead(context,selected,()=>output({items:selected,total:page.total,...(next!==undefined&&next<page.total?{nextOffset:next}:{})},delivered,allowance),params.history===true||params.view==="history"||params.view==="all",signal,params.projectId as string|undefined);
      }
      if(action==="read") {
        if(service.mode(context.permissionSessionId ?? context.sessionId)==="off") throw new Error("本次会话已关闭记忆");
        const db=await service.readDatabase(),project=await service.selectedProject(context,params.projectId as string|undefined);
        let item=await db.call("get",String(params.key ?? ""),project?.id);
        if(!item || (item.kind==="lesson")!==experience) throw new Error("条目不存在或不属于当前范围/类型");
        if(params.revision!==undefined && Number(params.revision)!==item.revision) {
          if(params.history!==true)throw new Error("读取旧修订需要history=true");
          item=await db.call("getRevision",item.key,Number(params.revision),project?.id);
          if(!item)throw new Error("该修订索引不存在；历史正文请按来源回查原始会话");
        }
        const sourceValid=await service.readValid(context,item);
        if(!sourceValid && params.history!==true) throw new Error("该记忆来源已撤回或修订，不再作为当前依据");
        if((item.lifecycle!=="active" || item.confidence!=="confirmed" || (item.expiresAt!==undefined && item.expiresAt<=Date.now()) || (item.effectiveAt!==undefined && item.effectiveAt>Date.now())) && params.history!==true) throw new Error("该条目仅供历史／候选查看，需要明确history=true，不可当作当前指导");
        if(params.section==="planned" && params.history!==true)throw new Error("未生效的更正请明确history=true查看，不能当作当前事实");
      const section=params.section==="planned"?JSON.stringify(item.pending ?? null):params.section==="evidence"?await service.evidence(context,item,Number(params.sourceIndex)||0,params.history===true):params.section==="details"?item.details ?? "此条没有额外详情":params.section==="sources"?JSON.stringify((params.history===true?[...item.sources,...(item.pending?.patch.sources ?? [])]:item.sources).map(visibleSource)):item.text;
        const chars=[...section],offset=Math.min(chars.length,Math.max(0,Math.floor(Number(params.offset)||0)));
        let length=Math.min(chars.length-offset,Math.max(100,Math.floor((allowance-200)*1.4)));
        let value:unknown;
        while(length>=0) {
          const next=offset+length;
          value={key:item.key,revision:item.revision,confidence:sourceValid?item.confidence:"unconfirmed",lifecycle:item.lifecycle,pendingAt:item.pending?.at,occurredAt:new Date(item.occurredAt).toISOString(),timeBasis:item.timeBasis ?? "recorded",updatedAt:new Date(item.updatedAt).toISOString(),reason:item.reason,effectiveAt:item.effectiveAt,expiresAt:item.expiresAt,section:params.section ?? "text",offset,content:chars.slice(offset,next).join(""),...(next<chars.length?{nextOffset:next}:{})};
          if(estimateMemoryTokens(JSON.stringify(value))<=allowance) break;
          length=Math.floor(length*0.8); if(length===0) break;
        }
        if(!service.settings().enabled || service.mode(context.permissionSessionId ?? context.sessionId)==="off")throw new Error("本次会话已关闭记忆");
        return service.deliverRead(context,[item],()=>output(value,[],allowance),params.history===true,signal,project?.id);
      }
      throw new Error("不支持的记忆操作");
    },
  });
}
