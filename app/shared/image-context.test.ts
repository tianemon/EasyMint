import { describe, expect, it } from "vitest";
import { contentWithoutImages, contextImageEntries, pendingImageBase64Bytes } from "./image-context";

describe("历史图片载荷", () => {
  it("只统计仍在模型投影里的 base64 图片，并保留非图片内容", () => {
    const content = [
      { type: "text", text: "[Image #1: /tmp/screenshot.png] 请检查布局" },
      { type: "image", data: "AAAA", mimeType: "image/png" },
      { type: "image", data: "BBBBCCCC", mimeType: "image/jpeg" },
    ];
    const entries = [
      { sourceEntry: { id: "a" }, messages: [{ content, timestamp: 123 }] },
      { sourceEntry: { id: "b" }, messages: [{ content: [{ type: "text", text: "已处理" }] }] },
    ];
    expect(contextImageEntries(entries)).toEqual([{ entryId: "a", imageCount: 2, encodedBytes: 12, preview: "[Image #1: /tmp/screenshot.png] 请检查布局", timestamp: 123 }]);
    expect(contentWithoutImages(content)).toEqual([content[0]]);
    expect(content).toHaveLength(3);
  });

  it("待发送图片按当前附件的 base64 数据估算，不把文档计入", () => {
    expect(pendingImageBase64Bytes("data:image/png;base64,AAAA")).toBe(4);
    expect(pendingImageBase64Bytes("data:application/pdf;base64,AAAA")).toBe(0);
    expect(pendingImageBase64Bytes(undefined)).toBe(0);
  });
});
