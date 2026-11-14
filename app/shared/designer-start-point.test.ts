/**
 * 「设计起点由谁定」的契约锚定（2026-09-16）。
 *
 * 修掉的问题：清单与选型指令原本都在共享段 DESIGN_SPEC 里，而 DESIGN_SPEC 同时进
 * **子 Agent 的** system prompt → 子 Agent 会去翻目录、自己挑模板（实测两轮各白耗 3~4 条调用，
 * 还把它推向规划量更大的自由设计路径）。
 *
 * 现在拆开：清单只给主会话，子 Agent 只认主会话指定的起点。谁把清单搬回共享段，这里就红。
 */
import { describe, it, expect } from "vitest";
import { DESIGNER_AGENT_PROMPT, MINT_DESIGN_BOOST } from "./prompts";
import { DESIGNER_TEMPLATE_FILES } from "./designer-templates";

describe("设计起点契约", () => {
  it("子 Agent 被明确告知：起点由主会话指定，不要自己选型/翻目录", () => {
    expect(DESIGNER_AGENT_PROMPT).toContain("起点由主会话指定");
    expect(DESIGNER_AGENT_PROMPT).toContain("不要自己选型");
    expect(DESIGNER_AGENT_PROMPT).toContain("自由设计");
    // 「没写起点就按自由设计直接开工」这个兜底必须在，否则子 Agent 会停下来等指令
    expect(DESIGNER_AGENT_PROMPT).toContain("没写就按自由设计直接开工");
  });

  it("子 Agent 版**不含**模板清单（清单在 = 它就会自己挑）", () => {
    for (const f of DESIGNER_TEMPLATE_FILES) {
      expect(DESIGNER_AGENT_PROMPT, `${f} 不该出现在子 Agent 的提示词里`).not.toContain(f);
    }
  });

  it("品牌也归委派方指定：子 Agent 不遍历 brand-tokens 挑品牌", () => {
    expect(DESIGNER_AGENT_PROMPT).toContain("不要遍历 brand-tokens");
    expect(MINT_DESIGN_BOOST).toContain("委派时把品牌名一并写进 prompt");
  });

  it("品牌库是内置 skill：两个宿主都只给 skill 相对路径，不再提项目内路径", () => {
    // 旧布局是按项目播种 .easymint/brand-tokens（每个项目 2.5MB）—— 提它就是回退
    expect(DESIGNER_AGENT_PROMPT).not.toContain(".easymint/brand-tokens");
    expect(MINT_DESIGN_BOOST).not.toContain(".easymint/brand-tokens");
    // 子 Agent 没有 use_skill，只能靠 available_skills 的 <location> 定位技能目录 —— 提示词必须说清这条依据
    expect(DESIGNER_AGENT_PROMPT).toContain("available_skills");
    expect(DESIGNER_AGENT_PROMPT).toContain("brands/<品牌>/DESIGN.md");
    expect(MINT_DESIGN_BOOST).toContain("brands/<品牌>/DESIGN.md");
    // 硬编码品牌数量是漂移源头（曾写死"74 个品牌"），清单归生成的 brands.md
    expect(DESIGNER_AGENT_PROMPT).not.toContain("74 个品牌");
    expect(MINT_DESIGN_BOOST).not.toContain("74 个品牌");
  });

  it("主会话版给出清单 + 指定要求（含委派写法）", () => {
    for (const f of DESIGNER_TEMPLATE_FILES) {
      expect(MINT_DESIGN_BOOST).toContain(f);
    }
    expect(MINT_DESIGN_BOOST).toContain("你负责指定");
    expect(MINT_DESIGN_BOOST).toContain("必须写进子任务的 prompt");
  });
});
