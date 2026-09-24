import { describe, expect, it } from "vitest";
import { IMAGE_PARTIAL_PATH_NOTE, IMAGE_PATH_ONLY_NOTE, encodeAttachedImages } from "@shared/image-context";
import { mapSessionMessages } from "./chat-utils";

describe("只发送图片路径的历史气泡", () => {
  it("SVG 无法编码为当前内联图片时保留路径提示，普通图片仍能编码", () => {
    const svg = { kind: "image", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" };
    const png = { kind: "image", dataUrl: "data:image/png;base64,YQ==" };
    expect(encodeAttachedImages([svg])).toEqual({ images: [], imageCount: 1 });
    expect(encodeAttachedImages([svg, png]).images).toEqual([{ type: "image", mimeType: "image/png", data: "YQ==" }]);
    expect(encodeAttachedImages([png], true)).toEqual({ images: [], imageCount: 1 });
  });
  it("重开会话后保留附件预览入口，并标明图片没有直接发送给模型", () => {
    const messages = mapSessionMessages([{
      type: "user",
      uuid: "user-1",
      message: { role: "user", timestamp: 1, content: [{ type: "text", text: `[Image #1: /tmp/diagram.png]\n${IMAGE_PATH_ONLY_NOTE}\n检查布局` }] },
    }]);
    expect(messages[0]).toMatchObject({ text: "检查布局", imagesPathOnly: true, attaches: [{ kind: "image", path: "/tmp/diagram.png" }] });
  });
  it("混合发送时隐藏路径提示文案，不误标全部图片只传路径", () => {
    const messages = mapSessionMessages([{
      type: "user",
      uuid: "user-2",
      message: { role: "user", timestamp: 1, content: [{ type: "text", text: `[Image #1: /tmp/diagram.svg]\n${IMAGE_PARTIAL_PATH_NOTE}\n检查布局` }] },
    }]);
    expect(messages[0]).toMatchObject({ text: "检查布局", attaches: [{ kind: "image", path: "/tmp/diagram.svg" }] });
    expect(messages[0]?.imagesPathOnly).toBeUndefined();
  });
});
