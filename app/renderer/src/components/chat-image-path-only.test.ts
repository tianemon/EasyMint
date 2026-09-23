import { describe, expect, it } from "vitest";
import { IMAGE_PATH_ONLY_NOTE } from "@shared/image-context";
import { mapSessionMessages } from "./chat-utils";

describe("只发送图片路径的历史气泡", () => {
  it("重开会话后保留附件预览入口，并标明图片没有直接发送给模型", () => {
    const messages = mapSessionMessages([{
      type: "user",
      uuid: "user-1",
      message: { role: "user", timestamp: 1, content: [{ type: "text", text: `[Image #1: /tmp/diagram.png]\n${IMAGE_PATH_ONLY_NOTE}\n检查布局` }] },
    }]);
    expect(messages[0]).toMatchObject({ text: "检查布局", imagesPathOnly: true, attaches: [{ kind: "image", path: "/tmp/diagram.png" }] });
  });
});
