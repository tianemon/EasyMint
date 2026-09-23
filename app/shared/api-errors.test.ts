import { describe, expect, it } from "vitest";
import { classifyApiError, normalizeApiError } from "./api-errors";

describe("中止错误跨主进程归一化后仍可识别", () => {
  it("AbortError 经主进程改为中文后，渲染层仍识别为主动停止", () => {
    const fromMain = normalizeApiError(new Error("AbortError: operation was aborted"));
    expect(fromMain).toBe("已停止");
    expect(classifyApiError(fromMain)).toMatchObject({ message: "已停止", tone: "warn" });
  });
});

describe("请求体超限", () => {
  it("网关与 SDK 的 413 错误都标出整理图片动作", () => {
    for (const raw of ["413 Payload Too Large", "failed to buffer the request body", "request_too_large"]) {
      const main = normalizeApiError(new Error(raw));
      expect(classifyApiError(main).kind).toBe("request_too_large");
    }
  });
});
