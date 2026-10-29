/**
 * 账号登录失败的**归类**守卫。
 *
 * 背景（2026-09-15 实测）：OpenAI Codex 换 token 返回
 * `403 {"error":{"code":"unsupported_country_region_territory", …}}` —— 浏览器授权页明明是绿灯
 * （那个页面由本地回调服务在**换 token 之前**发出），界面却显示「授权被拒绝，请重新登录」+ 一个
 * 点了永远失败的重试按钮。用户会一直重试，而真相是服务方的地区政策、重试无效。
 *
 * 因此这里钉两件事：
 * ① 地区限制必须**先**于通用 401/403 判据命中（顺序错就回归成"请重新登录"）；
 * ② 原始报错必须保留在 detail 里——否则用户回报问题时无据可依（曾经就是被丢掉的）。
 */
import { describe, expect, it, vi } from "vitest";

// 该模块 import 了 Modal / Toast（渲染层 ui 组件）；本测试只测纯函数，桩掉避免拖入副作用
vi.mock("../ui/Modal", () => ({ Modal: (): null => null }));
vi.mock("../ui/Toast", () => ({ toast: (): void => { /* 测试不触发 */ } }));

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CallbackBlockedNotice, callbackBlockedHint, failureReason, submitGuardError } from "./OAuthLoginDialog";

/** 用户实机复现的原始报文（一字未改） */
const REGION_403 =
  'OpenAI Codex token exchange failed (403): {"error":{"code":"unsupported_country_region_territory",'
  + '"message":"Country, region, or territory not supported","param":null,"type":"request_forbidden"}}';

describe("账号登录失败归类", () => {
  it("地区限制：给地区结论 + 补救建议，且不给「重试」（重试必然同样失败）", () => {
    const v = failureReason(REGION_403);
    expect(v.reason).toContain("地区不受支持");
    expect(v.reason).not.toContain("拒绝");   // 不能被通用 403 判据抢走
    expect(v.retryable).toBe(false);
    expect(v.hint).toBeTruthy();
    expect(v.detail).toBe(REGION_403);        // 原文一字不丢
  });

  it("地区限制的判据成立与文案无关：只认错误码（大小写不敏感）", () => {
    expect(failureReason("token exchange failed: unsupported_country_region_territory").retryable).toBe(false);
    expect(failureReason("Country, region, or territory not supported").retryable).toBe(false);
  });

  it("通用 401/403 与 invalid_grant 仍是可重试的「授权被拒绝」", () => {
    for (const raw of [
      "OpenAI Codex token exchange failed (400): {\"error\":\"invalid_grant\"}",
      "request failed with status 401",
      "OpenAI Codex token exchange failed (403): forbidden",
    ]) {
      const v = failureReason(raw);
      expect(v.reason).toBe("授权被拒绝，请重新登录");
      expect(v.retryable).toBe(true);
      expect(v.detail).toBe(raw);
    }
  });

  it("换 token 之后的另两处失败各有自己的结论（别都落到「登录失败」）", () => {
    expect(failureReason("Failed to extract accountId from token").reason).toBe("账号信息不完整，无法完成登录");
    expect(failureReason("Credential store modify failed for openai-codex").reason).toBe("登录成功但凭据写入失败，请重试");
  });

  it("拿不到原文时不编结论：只说登录失败，且仍可重试", () => {
    for (const empty of [undefined, "", "   "]) {
      const v = failureReason(empty);
      expect(v.reason).toBe("登录失败");
      expect(v.detail).toBeUndefined();
      expect(v.retryable).toBe(true);
    }
  });
});

describe("输入步骤的空值闸门", () => {
  it("text 步骤允许空提交——GitHub Copilot 的企业版域名「留空 = github.com」", () => {
    // 用户 2026-09-15 实测卡死：非企业版用户在这一步既不能留空、填别的又被判非法域名
    expect(submitGuardError("text", "")).toBeNull();
    expect(submitGuardError("text", "   ")).toBeNull();
    expect(submitGuardError("text", "company.ghe.com")).toBeNull();
  });

  it("凭据类步骤仍然拦住空提交（空值只会让流程报错）", () => {
    for (const kind of ["manual_code", "secret", "select"] as const) {
      expect(submitGuardError(kind, "")).toBe("请先填写内容");
      expect(submitGuardError(kind, "  ")).toBe("请先填写内容");
      expect(submitGuardError(kind, "x")).toBeNull();
    }
  });
});

/**
 * 回调端口绑不上时的处置建议。
 *
 * 背景（用户实测）：mac 上浏览器授权完自动跳回程序；Windows 上只能手动复制授权码。
 * 根因是 SDK 起回调服务的失败被静默吞掉（`startOAuthCallbackServer(...).catch(() => undefined)`），
 * 而 Windows 的 WinNAT/Hyper-V 会把 1455 划进保留段，端口没人占也绑不上（Winsock 10013 → EACCES）。
 * 界面必须把「系统保留」和「被别的程序占用」分开说：前者去关别的程序是白费功夫。
 */
describe("回调端口不可用的处置建议", () => {
  it("EACCES（Windows 系统保留）指向 WinNAT，而不是「关掉别的程序」", () => {
    const text = callbackBlockedHint("EACCES");
    expect(text).toContain("WinNAT");
    expect(text).not.toContain("占用");
  });

  it("EADDRINUSE（真被占用）给的是另一句话", () => {
    const text = callbackBlockedHint("EADDRINUSE");
    expect(text).toContain("占用");
    expect(text).not.toBe(callbackBlockedHint("EACCES"));
  });

  it("未知 errno 也给得出话（不能退化成空白提示）", () => {
    expect(callbackBlockedHint("UNKNOWN")).toBeTruthy();
  });
});

/**
 * 提示块的渲染接线（不只是文案选择器）：弹窗本体带状态、无法静态渲染，
 * 这块被抽成纯展示组件，正是为了能在这里断言"什么地方显示什么"。
 */
describe("回调端口提示块", () => {
  it("EACCES：给出端口号与两条命令（停/起 WinNAT）", () => {
    const html = renderToStaticMarkup(createElement(CallbackBlockedNotice, { port: 1455, code: "EACCES" }));
    expect(html).toContain("1455");
    expect(html).toContain("WinNAT");
    expect(html).toContain("net stop winnat");
    expect(html).toContain("net start winnat");
  });

  it("真被占用时不显示 WinNAT 命令（那是另一码事）", () => {
    const html = renderToStaticMarkup(createElement(CallbackBlockedNotice, { port: 1455, code: "EADDRINUSE" }));
    expect(html).toContain("占用");
    expect(html).not.toContain("net stop winnat");
  });
});
