/**
 * 系统提示词契约锚定测试（2026-09-06 prompt 健康度审查产出）。
 *
 * 锚定三个字符串协议（EM 侧无法控制 Pi 实现，锚的是 EM 依赖的契约面）：
 * ① override 纯替换：Mint 身份在、Pi 默认身份句不在——若有人改回「并存」或拼入 Pi 身份句即红
 * ② [系统消息] 前缀协议：systemMessage() 产物必须带前缀——Pi convertToLlm 按 user 透传 content，
 *    模型侧看不到 customType，识别全靠前缀（prompts.ts 注释自述的脆弱点）
 * ③ PERMISSION_RULES_PROMPT 锚定三档与运行时边界的产品语义。
 */
import { describe, it, expect } from "vitest";
import {
  MINT_SYSTEM_PROMPT,
  BUILDER_AGENT_PROMPT,
  EVALUATOR_AGENT_PROMPT,
  systemMessage,
  type SystemMessageKind,
  buildInitTriggerPrompt,
  buildDirectCreatePrompt,
  buildFeatureRecommendPrompt,
} from "../../shared/prompts";
import { PERMISSION_RULES_PROMPT } from "./prompt-sections";

const ALL_KINDS: SystemMessageKind[] = [
  "delegation",
  "shell",
  "project-created",
  "direct-create",
  "flow",
  "handoff",
  "summary",
  "learn",
];

describe("Mint 系统提示词 override 契约（纯替换架构）", () => {
  it("子 Agent 模板与主会话模型来源、可选任务 ID 及 MCP 发现方式一致", () => {
    expect(MINT_SYSTEM_PROMPT).not.toContain("模板决定了子 Agent 的 system prompt 与思考级别");
    expect(MINT_SYSTEM_PROMPT).toContain("模型与思考级别跟随主会话");
    for (const prompt of [BUILDER_AGENT_PROMPT, EVALUATOR_AGENT_PROMPT]) {
      expect(prompt).toContain("不要求创建 task.json");
      expect(prompt).toContain("CodeGraph 可用时");
      expect(prompt).toContain("searchTools");
      expect(prompt).toContain("不可用时");
      expect(prompt).toContain("不为验收引入构建工具");
    }
    expect(BUILDER_AGENT_PROMPT).toContain("只暂存本任务的变更");
    expect(PERMISSION_RULES_PROMPT).toContain("系统许可不等于用户授权");
  });
  it("Mint 身份在、Pi 默认身份句不在", () => {
    expect(MINT_SYSTEM_PROMPT).toContain("你叫 Mint");
    expect(MINT_SYSTEM_PROMPT).not.toContain("You are an expert coding assistant operating inside pi");
  });
  it("结构关键段存在（防结构漂移）", () => {
    // 规则去编号后锚标题（标题语义锚比数字锚稳定——插入新规则不重排）
    for (const seg of ["<identity>", "<easymint>", "<rules>", "**通用规则引用**", "**排查问题**"]) {
      expect(MINT_SYSTEM_PROMPT).toContain(seg);
    }
  });
  it("Mint 专属规则段齐全（需求理解与排查基调）", () => {
    expect(MINT_SYSTEM_PROMPT).toContain("**需求理解**");
    expect(MINT_SYSTEM_PROMPT).toContain("表象描述先映射术语再对齐");
    // 排查通用条目已下沉 AGENTS.md 模板——Mint 侧保留对话基调（实测真相），模板侧锚通用引用行
    expect(MINT_SYSTEM_PROMPT).toContain("**用户实测即真相**");
    expect(MINT_SYSTEM_PROMPT).toContain("AGENTS.md");
  });
});

describe("[系统消息] 前缀协议", () => {
  it("systemMessage 包装不篡改 content、customType 统一（前缀由调用方在 content 内书写）", () => {
    for (const kind of ALL_KINDS) {
      const msg = systemMessage(kind, "测试内容");
      expect(msg.content).toBe("测试内容");
      expect(msg.customType).toBe("system_message");
      expect(msg.display).toBe(true);
    }
  });
  it("prompts.ts 的系统消息构建函数 content 均以 [系统消息] 开头（业务层前缀约定）", () => {
    const samples = [
      buildInitTriggerPrompt("/proj", "上下文", "指令"),
      buildDirectCreatePrompt("测试项目", ""),
      buildFeatureRecommendPrompt("项目信息"),
    ];
    for (const s of samples) {
      expect(s.startsWith("[系统消息]"), s.slice(0, 40)).toBe(true);
    }
  });
});

describe("权限段产品语义", () => {
  it("三档、共同核心底线与运行时执行均有说明", () => {
    for (const phrase of ["标准模式", "完全访问", "系统核心", "高度敏感凭据", "运行时安全边界", "不要尝试绕过"]) {
      expect(PERMISSION_RULES_PROMPT).toContain(phrase);
    }
  });
  it("完全访问明确包含普通用户目录，标准模式明确包含开发资源", () => {
    for (const phrase of ["桌面", "文档", "下载", "依赖缓存", "工具链", "SDK", "临时目录"]) {
      expect(PERMISSION_RULES_PROMPT).toContain(phrase);
    }
  });
  it("不再把 /tmp 或普通用户目录描述为绝对禁区", () => {
    expect(PERMISSION_RULES_PROMPT).not.toContain("/tmp");
    expect(PERMISSION_RULES_PROMPT).not.toContain("用户目录写入");
  });
  // 2026-09-17：三档定案为 **只读 / 标准 / 完全访问**；甲方案把标准档**改回套沙盒**（默认档保留内核边界），
  // 并补齐网络白名单与精确豁免。提示词必须说清这几条，否则模型会把"边界"当"故障"，反复换写法重试。
  it("说清三档、边界来自执行前判定与系统沙盒，且只读档的代价已写明", () => {
    expect(PERMISSION_RULES_PROMPT).toContain("只读模式");
    expect(PERMISSION_RULES_PROMPT).toContain("执行前判定");
    expect(PERMISSION_RULES_PROMPT).toContain("用宿主真实环境执行");
    expect(PERMISSION_RULES_PROMPT).toContain("Playwright");
    // 只读档的定义要写明"不执行"，且必须点出联网工具一并停用（否则模型会以为 web_fetch 还能用）
    expect(PERMISSION_RULES_PROMPT).toContain("读自由");
    expect(PERMISSION_RULES_PROMPT).toContain("web_fetch");
    // 标准档：内核边界 + 网络白名单 + 沙盒违规注解的解读方式
    expect(PERMISSION_RULES_PROMPT).toContain("系统级沙盒");
    expect(PERMISSION_RULES_PROMPT).toContain("域名白名单");
    expect(PERMISSION_RULES_PROMPT).toContain("sandbox_violations");
  });
});
