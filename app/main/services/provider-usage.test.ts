import { describe, expect, it, vi } from "vitest";
import { createProviderUsageService, parseProviderUsage, usageRequest, type UsageAuth } from "./provider-usage";
import { accountUsageLabels } from "../../shared/provider-usage";
import type { ApiProvidersData, ProviderConfig } from "../../shared/platform-presets";
const config=(presetId:string,id=presetId):ProviderConfig=>({id,presetId,name:presetId,apiKey:"",model:"fixture",models:["fixture"],createdAt:0});
const key:UsageAuth={token:"fixture-key",type:"api_key"};

describe("provider account usage contracts",()=>{
 it.each([
  ["moonshotai","https://api.moonshot.ai/v1/users/me/balance"],
  ["moonshotai-cn","https://api.moonshot.cn/v1/users/me/balance"],
  ["kimi-coding","https://api.kimi.com/coding/v1/usages"],
  ["zai","https://api.z.ai/api/monitor/usage/quota/limit"],
  ["zai-coding-cn","https://open.bigmodel.cn/api/monitor/usage/quota/limit"],
  ["openrouter","https://openrouter.ai/api/v1/key"],
 ])("routes %s only to its own account endpoint",(preset,url)=>{
  expect(usageRequest(config(preset),key)).toEqual({url,headers:{Authorization:"Bearer fixture-key",Accept:"application/json"}});
 });
 it("distinguishes MiniMax secret-key balances and Token Plan quota by the official key contract",()=>{
  expect(usageRequest(config("minimax-cn"),{...key,token:"sk-api-fixture"})?.url).toBe("https://api.minimaxi.com/account/query_balance");
  expect(usageRequest(config("minimax"),{...key,token:"sk-cp-fixture"})?.url).toBe("https://api.minimax.io/v1/token_plan/remains");
 });
 it("does not expose Claude subscription queries for ordinary API keys or infer custom platforms",()=>{
  expect(accountUsageLabels(config("anthropic"))).toBeUndefined();
  expect(usageRequest(config("anthropic"),key)).toBeUndefined();
  expect(usageRequest(config("custom"),key)).toBeUndefined();
  expect(usageRequest(config("constructor"),key)).toBeUndefined();
  expect(accountUsageLabels(config("constructor"))).toBeUndefined();
  expect(usageRequest({...config("anthropic"),authType:"oauth"},{...key,type:"oauth"})?.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
 });
 it("keeps enterprise Copilot tokens on the matching cloud host and does not fall back to github.com",()=>{
  expect(usageRequest(config("github-copilot"),{...key,enterpriseUrl:"https://acme.ghe.com"})?.url).toBe("https://api.acme.ghe.com/copilot_internal/user");
  expect(usageRequest(config("github-copilot"),{...key,enterpriseUrl:"http://localhost:3000"})).toBeUndefined();
 });
 it("recognizes only verified SiliconFlow direct origins for custom connections",()=>{
  const direct={...config("custom"),baseUrl:"https://api.siliconflow.cn/v1"};
  expect(accountUsageLabels(direct)).toContain("balance");
  expect(usageRequest(direct,key)?.url).toBe("https://api.siliconflow.cn/v1/user/info");
  expect(usageRequest({...direct,baseUrl:"https://api.ap.siliconflow.com/v1"},key)?.url).toBe("https://api.ap.siliconflow.com/v1/user/info");
  expect(accountUsageLabels({...direct,baseUrl:"https://api.siliconflow.cn.example.com/v1"})).toBeUndefined();
  expect(accountUsageLabels({...direct,baseUrl:"http://api.siliconflow.cn/v1"})).toBeUndefined();
  expect(parseProviderUsage("siliconflow-cn",{code:20000,status:true,data:{totalBalance:"88.88",chargeBalance:"88.00",balance:"0.88",email:"not returned"}}).map(row=>[row.label,row.value])).toEqual([["balance","88.88"],["recharge","88.00"],["baseBalance","0.88"]]);
 });
 it("preserves zero and negative monetary balances without manufacturing missing fields",()=>{
  const rows=parseProviderUsage("moonshotai-cn",{status:true,data:{available_balance:0,cash_balance:"-2.3400",voucher_balance:null}});
  expect(rows.map(r=>[r.label,r.value,r.currency])).toEqual([["balance","0","CNY"],["cash","-2.3400","CNY"]]);
  expect(parseProviderUsage("moonshotai",{status:false,data:{available_balance:100}})).toEqual([]);
 });
 it("shows OpenRouter key usage and caps without pretending to know its account wallet",()=>{
  const rows=parseProviderUsage("openrouter",{data:{usage:0,usage_daily:"2.5",limit_remaining:4,limit:10}});
  expect(rows.map(r=>r.label)).toEqual(["usage","dailyUsage","keyRemaining"]);
  expect(rows.some(r=>r.label==="balance")).toBe(false);
  expect(parseProviderUsage("openrouter",{data:{usage:2,limit:null}}).at(-1)?.unit).toBe("unlimited");
 });
 it("interprets MiniMax usage_count as remaining and retains the reported weekly boost",()=>{
  const rows=parseProviderUsage("minimax",{base_resp:{status_code:0},model_remains:[{model_name:"MiniMax",current_interval_total_count:1500,current_interval_usage_count:1417,current_weekly_remaining_percent:80,weekly_boost_permille:1500,end_time:1800000000000}]});
  expect(Number(rows[0]!.value)).toBeCloseTo(1417/1500*100);
  expect(rows[0]!.unit).toBe("remainingPercent");expect(rows[1]!.value).toBe("120");
  expect(rows[0]!.resetAt).toBe(new Date(1800000000000).toISOString());
 });
 it("does not call inaccessible MiniMax models unlimited, and handles normal account balances",()=>{
  expect(parseProviderUsage("minimax",{model_remains:[{current_interval_total_count:0,current_weekly_total_count:0,current_interval_status:3,current_weekly_status:3}]})).toEqual([]);
  expect(parseProviderUsage("minimax-cn",{base_resp:{status_code:1004},available_amount:"100"})).toEqual([]);
  expect(parseProviderUsage("minimax-cn",{base_resp:{status_code:0},available_amount:"42.25",cash_balance:"40"})[0]).toMatchObject({label:"balance",value:"42.25",unit:"money"});
 });
 it("parses only actual Claude and Kimi quota windows, preserving zero usage",()=>{
  expect(parseProviderUsage("anthropic",{five_hour:{utilization:0},seven_day:{utilization:42,resets_at:"2026-11-01T00:00:00Z"}}).map(r=>r.value)).toEqual(["0","42"]);
  expect(parseProviderUsage("kimi-coding",{usages:{limit_5h:{used_ratio:.4,reset_time:"2026-11-01T00:00:00Z"},limit_7d:{}}}).map(r=>[r.label,r.value])).toEqual([["fiveHour","40"]]);
  const corrected=parseProviderUsage("kimi-coding",{usages:{limit_5h:{used_ratio:0}},limits:[{window:{duration:300,timeUnit:"TIME_UNIT_MINUTE"},detail:{limit:100,used:88}}]});
  expect(corrected).toHaveLength(1);expect(corrected[0]!.value).toBe("88");
 });
 it("keeps Z.ai weekly and monthly-tool windows distinct and respects failure envelopes",()=>{
  const rows=parseProviderUsage("zai",{success:true,data:{limits:[{type:"CREDIT_LIMIT",unit:3,number:5,percentage:20},{type:"TOKENS_LIMIT",unit:6,number:1,percentage:50},{type:"TIME_LIMIT",percentage:0}]}});
  expect(rows.map(r=>[r.label,r.value])).toEqual([["fiveHour","20"],["weekly","50"],["monthlyTools","0"]]);
  expect(parseProviderUsage("zai",{success:false,data:{limits:[{type:"TIME_LIMIT",percentage:0}]}})).toEqual([]);
 });
 it("maps Copilot remaining percentages and personal uncapped entitlements",()=>{
  expect(parseProviderUsage("github-copilot",{quota_snapshots:{premium_interactions:{percent_remaining:70},chat:{unlimited:true},completions:{}}}).map(r=>[r.label,r.unit,r.value])).toEqual([["premium","usedPercent","30"],["chat","unlimited",undefined]]);
  expect(parseProviderUsage("anthropic",{five_hour:{utilization:null},seven_day:{utilization:Infinity}})).toEqual([]);
 });
});

function fixture(){
 let token="fixture-key",time=0;
 const a=config("openrouter","a"),b=config("moonshotai-cn","b");
 const state:ApiProvidersData={current:"a",configs:{a,b}};
 const auth=vi.fn(async()=>({...key,token}));
 const request=vi.fn<typeof fetch>(async()=>Response.json({data:{usage:10,limit:20,limit_remaining:10}}));
 const service=createProviderUsageService({providers:()=>state,auth,fetch:request,now:()=>time});
 return {service,state,auth,request,setToken:(value:string)=>{token=value;},advance:()=>{time+=61_000;}};
}
describe("account usage query isolation",()=>{
 it("caches by credential identity, coalesces requests and never permits redirects",async()=>{
  const f=fixture();await Promise.all([f.service.query("a"),f.service.query("a")]);expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request.mock.calls[0]![1]).toMatchObject({redirect:"error"});
  await f.service.query("a");expect(f.request).toHaveBeenCalledTimes(1);
  f.setToken("new-key");await f.service.query("a");expect(f.request).toHaveBeenCalledTimes(2);
  f.advance();await f.service.query("a");expect(f.request).toHaveBeenCalledTimes(3);
 });
 it("rejects stale account IDs before resolving credentials",async()=>{
  const f=fixture();expect(await f.service.query("b")).toEqual({ok:false,reason:"changed"});expect(f.auth).not.toHaveBeenCalled();
 });
 it("does not return a late result after switching providers",async()=>{
  const f=fixture();let resolve!:(response:Response)=>void;
  f.request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const query=f.service.query("a");await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(1));
  f.state.current="b";resolve(Response.json({data:{usage:10}}));expect(await query).toEqual({ok:false,reason:"changed"});
 });
 it("rejects an in-place platform change while a request is running",async()=>{
  const f=fixture();let resolve!:(response:Response)=>void;
  f.request.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  const query=f.service.query("a");await vi.waitFor(()=>expect(f.request).toHaveBeenCalledTimes(1));
  f.state.configs.a!.presetId="moonshotai";resolve(Response.json({data:{usage:10}}));
  expect(await query).toEqual({ok:false,reason:"changed"});
 });
 it.each([[401,"auth"],[403,"auth"],[429,"rateLimit"],[500,"unavailable"]] as const)("returns a safe failure for HTTP %s",async(status,reason)=>{
  const f=fixture();f.request.mockResolvedValueOnce(new Response("secret response body",{status}));
  expect(await f.service.query("a")).toEqual({ok:false,reason});
  if(status===429){await f.service.query("a",true);expect(f.request).toHaveBeenCalledTimes(1);}
 });
 it("handles malformed, unauthenticated, or failed requests without claiming zero usage",async()=>{
  const f=fixture();f.request.mockResolvedValueOnce(Response.json({unrelated:0}));expect(await f.service.query("a")).toEqual({ok:false,reason:"invalid"});
  f.auth.mockRejectedValueOnce(new Error("do not expose token"));expect(await f.service.query("a",true)).toEqual({ok:false,reason:"unavailable"});
  f.request.mockRejectedValueOnce(new Error("timeout"));expect(await f.service.query("a",true)).toEqual({ok:false,reason:"unavailable"});
 });
});
