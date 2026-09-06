/**
 * 系统提示词契约锚定测试（2026-09-06 prompt 健康度审查产出）。
 *
 * 锚定三个字符串协议（EM 侧无法控制 Pi 实现，锚的是 EM 依赖的契约面）：
 * ① override 纯替换：Mint 身份在、Pi 默认身份句不在——若有人改回「并存」或拼入 Pi 身份句即红
 * ② [系统消息] 前缀协议：systemMessage() 产物必须带前缀——Pi convertToLlm 按 user 透传 content，
 *    模型侧看不到 customType，识别全靠前缀（prompts.ts 注释自述的脆弱点）
 * ③ PERMISSION_RULES_PROMPT 与 permission-rules.ts 措辞同步：prompt 段列出的禁区项必须都在常量里、
 *    关键项双向一致——常量或 prompt 任一侧改动未同步即红（注释「需同步维护」的机械化）
 */
import { describe, it, expect } from "vitest";
import {
  MINT_SYSTEM_PROMPT,
  systemMessage,
  type SystemMessageKind,
  buildInitTriggerPrompt,
  buildProjectCreatedPrompt,
  buildDirectCreatePrompt,
  buildFeatureRecommendPrompt,
} from "../../shared/prompts";
import { PERMISSION_RULES_PROMPT } from "./prompt-sections";
import {
  SECRET_FORBIDDEN,
  SYSTEM_FORBIDDEN,
  USER_FORBIDDEN_WRITE,
} from "./permission/permission-rules";

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
  it("Mint 身份在、Pi 默认身份句不在", () => {
    expect(MINT_SYSTEM_PROMPT).toContain("你叫 Mint");
    expect(MINT_SYSTEM_PROMPT).not.toContain("You are an expert coding assistant operating inside pi");
  });
  it("结构关键段存在（防结构漂移）", () => {
    for (const seg of ["<identity>", "<easymint>", "<rules>", "**13. 排查问题**"]) {
      expect(MINT_SYSTEM_PROMPT).toContain(seg);
    }
  });
  it("Mint 专属规则段齐全（需求理解规则 12 与排查规则 13）", () => {
    expect(MINT_SYSTEM_PROMPT).toContain("**12. 需求理解**");
    expect(MINT_SYSTEM_PROMPT).toContain("表象描述先映射术语再对齐");
    expect(MINT_SYSTEM_PROMPT).toContain("bash 执行前预判");
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
      buildProjectCreatedPrompt("项目描述"),
      buildDirectCreatePrompt("测试项目", ""),
      buildFeatureRecommendPrompt("项目信息"),
    ];
    for (const s of samples) {
      expect(s.startsWith("[系统消息]"), s.slice(0, 40)).toBe(true);
    }
  });
});

describe("权限段与规则常量同步（双维护锚定）", () => {
  it("凭据禁区：prompt 段列出的每项都在 SECRET_FORBIDDEN 常量中", () => {
    for (const item of ["~/.ssh", "~/.aws", "~/.gnupg", "~/.kube", "~/.docker", "~/.npmrc", "~/Library/Keychains"]) {
      expect(PERMISSION_RULES_PROMPT).toContain(item);
      expect(SECRET_FORBIDDEN).toContain(item);
    }
  });
  it("系统核心目录：prompt 段 macOS 代表项 ⊆ SYSTEM_FORBIDDEN", () => {
    for (const item of ["/etc", "/usr", "/System", "/var"]) {
      expect(PERMISSION_RULES_PROMPT).toContain(item);
      expect(SYSTEM_FORBIDDEN).toContain(item);
    }
  });
  it("用户目录禁写：prompt 段代表项 ⊆ USER_FORBIDDEN_WRITE", () => {
    for (const item of ["~/Desktop", "~/Documents", "~/Downloads", "~/Library"]) {
      expect(PERMISSION_RULES_PROMPT).toContain(item);
      expect(USER_FORBIDDEN_WRITE).toContain(item);
    }
  });
  it("两模式关键措辞存在（Mint 依被拒错误文案应对）", () => {
    expect(PERMISSION_RULES_PROMPT).toContain("标准模式");
    expect(PERMISSION_RULES_PROMPT).toContain("完全访问");
    expect(PERMISSION_RULES_PROMPT).toContain("不要尝试绕过");
  });
});
