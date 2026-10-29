import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MINT_SYSTEM_PROMPT, BUILDER_AGENT_PROMPT, CONFIRM_DEVELOPMENT_PROMPT } from "../../shared/prompts";
import { createTaskTool } from "./task/tool";
import { createTodoWriteTool } from "./tools/todo-tool";
import type { Store } from "./store";

vi.mock("electron",()=>({app:{isPackaged:false,getPath:()=>"/tmp"},BrowserWindow:{getAllWindows:()=>[]}}));
vi.mock("./agent-templates",()=>({listTemplates:()=>[]}));
vi.mock("./pi-sdk",async importOriginal=>({...await importOriginal<typeof import("./pi-sdk")>(),getDefineToolFn:async()=>(definition:unknown)=>definition}));
const read=(file:string)=>fs.readFileSync(path.resolve(process.cwd(),file),"utf8");

describe("delegation and progress policy consistency",()=>{
 it("uses context isolation as the main purpose and does not turn file counts or project tiers into automatic delegation",()=>{
  const policy=MINT_SYSTEM_PROMPT.slice(MINT_SYSTEM_PROMPT.indexOf("**任务执行**"),MINT_SYSTEM_PROMPT.indexOf("**Task 委派分工总则：**"));
  expect(policy).toContain("默认亲自执行");
  expect(policy).toContain("长任务的上下文隔离（主要用途）");
  expect(policy).toContain("独立方向的异步并行");
  expect(policy).toContain("按需独立复核");
  expect(policy).toContain("主会话责任与交接成本");
  expect(policy).toContain("不要重复派遣相同任务");
  expect(policy).toContain("文件、需要测试或提交、项目档位较高，本身都不构成委派理由");
 });
 it("keeps one progress threshold and separates formal work from this run's stages",()=>{
  expect(MINT_SYSTEM_PROMPT).toContain("超过 3 个有实际意义的执行阶段");
  expect(MINT_SYSTEM_PROMPT).toContain("用户明确安排或要求展示多步骤任务");
  expect(MINT_SYSTEM_PROMPT).toContain("不能把读文件、编辑、跑测试、提交机械算作四步");
  expect(MINT_SYSTEM_PROMPT).toContain("不再复制同名任务清单");
  expect(MINT_SYSTEM_PROMPT).toContain("不代替 set_task_status 或委派结果自动回写");
  expect(MINT_SYSTEM_PROMPT).toContain("阶段内每次读文件、工具调用或命令输出不触发更新");
 });
 it("removes contradictory legacy obligations from all active decision surfaces",()=>{
  const sources=[MINT_SYSTEM_PROMPT,BUILDER_AGENT_PROMPT,CONFIRM_DEVELOPMENT_PROMPT,read("resources/skills/creation-guide/SKILL.md"),read("resources/skills/ui-sync/SKILL.md")];
  for(const source of sources){
   expect(source).not.toMatch(/中等及以上(?:项目)?委派 Builder/);
   expect(source).not.toContain("必须委派（上下文保护");
   expect(source).not.toContain("Builder 编码 → Evaluator 验收");
   expect(source).not.toContain("继续 Builder/Evaluator 循环");
   expect(source).not.toContain("负责「想」");
   expect(source).not.toContain("两问都指向委派才委派");
   expect(source).not.toContain("委派实现的交 Evaluator 验收");
   expect(source).not.toContain("model/provider 可随时按需覆盖");
   expect(source).not.toContain("默认继承全局模型");
   expect(source).not.toContain("Mint 会调 Evaluator 验收你的产出");
   expect(source).not.toContain("验收是 Evaluator 的工作");
  }
  expect(MINT_SYSTEM_PROMPT).toContain("模型与思考级别跟随主会话");
  expect(MINT_SYSTEM_PROMPT).toContain("task 没有单独的 model/provider 覆盖参数");
  expect(BUILDER_AGENT_PROMPT).not.toContain("Evaluator 会用浏览器/截图验收渲染，你无需");
  expect(BUILDER_AGENT_PROMPT).toContain("未明确此安排时，不预设之后一定有 Evaluator");
 });
 it("does not require exhaustive rereads, line-count task creation or redundant approval",()=>{
  expect(MINT_SYSTEM_PROMPT).not.toContain("把所有相关文件完整读一遍");
  expect(MINT_SYSTEM_PROMPT).not.toContain("每轮自行核实真实进度");
  expect(MINT_SYSTEM_PROMPT).not.toContain("拆完呈现确认");
  const sync=read("resources/skills/ui-sync/SKILL.md");
  expect(sync).not.toContain("≤20 行");
  expect(sync).not.toContain("超出小微范围");
  expect(sync).toContain("无对应正式任务时不调用");
  expect(sync).toContain("不为调用状态工具补建任务");
  const docs=read("resources/skills/dev-docs/SKILL.md");
  expect(docs).not.toContain("修改或删除已有内容，先向用户列出要改的部分确认");
  expect(docs).toContain("已获同一对象与范围授权的文档更新直接执行");
 });
 it("preserves terminal status ownership when independent review follows a finished delegation",()=>{
  expect(MINT_SYSTEM_PROMPT).toContain("委派结果已自动进入终态时，做临时独立复核");
  const sync=read("resources/skills/ui-sync/SKILL.md");
  expect(sync).toContain("已完成任务的临时复核不回退原状态");
  expect(sync).toContain("不按「做个」「加个」「新增」等词自动触发");
  expect(sync).not.toContain("用户提出新需求、新建功能时使用");
  expect(MINT_SYSTEM_PROMPT).toContain("深度 = 1");
 });
 it("exposes the intended purposes and asynchronous result contract in actual task metadata",async()=>{
  const task=await createTaskTool({cwd:"/fixture",agentDir:"/fixture",store:{} as Store,parentSessionId:"policy-test"});
  expect(task.description).toContain("主要用途是**长任务的上下文隔离**");
  expect(task.description).toContain("异步并行");
  expect(task.description).toContain("独立复核");
  expect(task.description).toContain("立即返回启动信息");
  expect(task.description).toContain("完成结果异步送回主会话");
  const schema=task.parameters as unknown as {properties:Record<string,unknown>;required:string[]};
  expect(schema.properties.taskId).toBeDefined();
  expect(schema.properties.tasks).toBeDefined();
  expect(schema.properties.model).toBeUndefined();expect(schema.properties.provider).toBeUndefined();
 });
 it("keeps todo's real full-replacement/validation contract without per-tool-call or formal-task duplication",async()=>{
  const todo=await createTodoWriteTool("/fixture","policy-test");
  expect(todo.description).toContain("传完整清单（含已完成项");
  expect(todo.description).toContain("至多 1 项 in_progress");
  expect(todo.description).toContain("同一阶段内的工具操作不反复回填");
  expect(todo.description).toContain("不复制 task.json 的正式任务清单");
  expect(todo.description).toContain("恢复执行时清除 waiting");
  expect(todo.description).not.toContain("每完成一步立即");
  const source=read("app/main/services/tools/todo-tool.ts");
  expect(source).not.toContain("≥3 步");
  expect(source).not.toContain("修 bug 目标明确的不建单");
 });
});
