import fs from "node:fs";
import path from "node:path";
import {expect,it} from "vitest";

const skill = (name:string) => fs.readFileSync(path.resolve("resources/skills",name,"SKILL.md"),"utf8");

it("keeps simple creation tasks distinct from minimal creation and ordinary maintenance", () => {
  const guide = skill("creation-guide"), techspec = skill("creation-flow-techspec");
  const simpleRow = guide.split("\n").find(line => /^\| 简单 \|/u.test(line));
  expect(simpleRow).toMatch(/需求文档\s*\+\s*task\.json/u);
  expect(techspec).toMatch(/简单新建准备需求文档和task\.json/u);
  expect(techspec).toMatch(/极简新建不为流程补建任务文件/u);
  expect(techspec).toMatch(/接手或维护已有项目时，无task\.json也完成适用实现与验证/u);
  expect(techspec).not.toMatch(/简单项目不为流程补建任务文件/u);
});

it("routes prototype delegation through declared tools and explicitly carries design context", () => {
  const prototype = skill("creation-flow-prototype"), guide = skill("creation-guide");
  expect(prototype).not.toContain("Mint-D");
  expect(prototype).toMatch(/从当前工具清单选择实际可用角色/u);
  expect(prototype).toMatch(/省略 agent 使用标准执行者/u);
  expect(prototype).toMatch(/协作模式不会自动复制给子代理/u);
  expect(prototype).toMatch(/相关设计职责[\s\S]*明确写进子任务/u);
  expect(guide).not.toContain("主提示词「任务执行」");
});

it("preserves prototype acceptance and missing development authorization after retiring the button", () => {
  const guide = skill("creation-guide"), prototype = skill("creation-flow-prototype"), techspec = skill("creation-flow-techspec");
  expect(guide).toMatch(/G3 UI 原型[\s\S]*G4 用户验收原型[\s\S]*G5 方案[\s\S]*G6 正式开发[\s\S]*G7 实际验证/u);
  expect(prototype).toContain("同意制作不等于看过成果后的验收");
  expect(prototype).toContain("不自动扩大为正式开发许可");
  expect(techspec).toContain("必要原型验收、重要取舍和环境前提满足后");
  expect(techspec).toContain("尚缺正式开发授权时，在对话中简短确认一次");
  expect(techspec).toContain("取消或未回应不当同意");
  expect([guide,prototype,techspec].join("\n")).not.toMatch(/show_confirm_dev|开发确认按钮/u);
});
