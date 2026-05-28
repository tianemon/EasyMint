import { describe, it, expect } from "vitest";
import { Readable } from "stream";
import { JsonlParser } from "./jsonl-parser";
import type { JsonlEvent } from "./jsonl-parser";

describe("JsonlParser", () => {
  it("解析单行 assistant JSONL", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_1",
          content: [{ type: "text", text: "Hello, world!" }],
          stop_reason: null,
        },
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("assistant");
    expect((events[0] as JsonlEvent & { delta: string }).delta).toBe("Hello, world!");
  });

  it("解析 system/init 事件", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "system",
        subtype: "init",
        model: "claude-sonnet-4-6",
        session_id: "sess-abc",
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("system");
    expect((events[0] as Record<string, unknown>).subtype).toBe("init");
    expect((events[0] as Record<string, unknown>).model).toBe("claude-sonnet-4-6");
  });

  it("解析 tool_use 事件（assistant 包装）", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_2",
          content: [
            {
              type: "tool_use",
              id: "toolu_001",
              name: "read_file",
              input: { filePath: "/path/to/file.ts" },
            },
          ],
        },
      }) + "\n"
    );

    expect(events.length).toBe(1);
    // assistant message with only tool_use blocks returns tool_use events
    // 这里 classifyAssistant 中，如果只有 tool_use 无 text，则返回 null
    // tool_use 通过 classifyAssistant 会发出 tool_use 事件
  });

  it("解析 tool_use 事件（stream_event content_block_start）", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_002",
            name: "write_file",
          },
        },
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("tool_use");
    expect((events[0] as Record<string, unknown>).id).toBe("toolu_002");
    expect((events[0] as Record<string, unknown>).name).toBe("write_file");
  });

  it("解析 tool_result 事件（user 包装）", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_001",
              content: "File content here",
              is_error: false,
            },
          ],
        },
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("tool_result");
    expect((events[0] as Record<string, unknown>).toolUseId).toBe("toolu_001");
    expect((events[0] as Record<string, unknown>).isError).toBe(false);
  });

  it("解析 result 事件", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "result",
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.015,
        duration_ms: 3200,
        stop_reason: "end_turn",
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("result");
  });

  it("多行 JSONL 批量解析", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    const lines = [
      { type: "system", subtype: "init", model: "claude-sonnet-4-6" },
      {
        type: "assistant",
        message: { id: "msg_1", content: [{ type: "text", text: "Preparing..." }] },
      },
      {
        type: "assistant",
        message: {
          id: "msg_2",
          content: [
            { type: "tool_use", id: "tu1", name: "write_file", input: { path: "/f.txt" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu1", content: "written" }],
        },
      },
    ];

    parser.feed(lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0].type).toBe("system");
    expect(events[1].type).toBe("assistant");
  });

  it("不完整行（跨 chunk 拼接）", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    // 完整的一行 JSON 被分割到多个 feed 调用中
    const fullJson = JSON.stringify({
      type: "assistant",
      message: { id: "msg_1", content: [{ type: "text", text: "Split message" }] },
    });

    parser.feed(fullJson.slice(0, 20));
    parser.feed(fullJson.slice(20) + "\n");

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("assistant");
  });

  it("无效 JSON 行静默跳过", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed("this is not valid json\n");
    parser.feed(
      JSON.stringify({
        type: "system",
        subtype: "init",
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("system");
  });

  it("无效 JSON 行在 emitRaw 模式下发出 raw 事件", () => {
    const parser = new JsonlParser({ emitRaw: true });
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed("not valid json\n");

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("raw");
  });

  it("空行跳过", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed("\n\n\n");
    parser.feed(
      JSON.stringify({
        type: "assistant",
        message: { id: "msg_1", content: [{ type: "text", text: "After blanks" }] },
      }) + "\n"
    );

    expect(events.length).toBe(1);
  });

  it("flush 清空缓冲区剩余内容", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    // 末尾没有换行符
    parser.feed(
      JSON.stringify({
        type: "system",
        subtype: "init",
      })
    );
    parser.flush();

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("system");
  });

  it("stop 清理监听器并清空缓冲区", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    const stream = new Readable({
      read() {
        /* noop */
      },
    });
    parser.start(stream);
    parser.feed(JSON.stringify({ type: "system", subtype: "init" }) + "\n");
    parser.stop();

    // 停止后继续 push 不会触发事件
    stream.push(JSON.stringify({ type: "system", subtype: "status" }) + "\n");
    expect(events.length).toBe(1);
  });

  it("从 Readable stream 解析（模拟 subprocess stdout）", async () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    const stream = new Readable({
      read() {
        /* noop */
      },
    });
    parser.start(stream);

    stream.push(
      JSON.stringify({
        type: "system",
        subtype: "init",
      }) + "\n"
    );
    stream.push(
      JSON.stringify({
        type: "assistant",
        message: { id: "msg_1", content: [{ type: "text", text: "Streaming" }] },
      }) + "\n"
    );
    stream.push(null); // end

    // 等待 stream end 触发 flush
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events.length).toBe(2);
    expect(events[0].type).toBe("system");
    expect(events[1].type).toBe("assistant");
  });

  it("text_delta 流式增量事件", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "partial text" },
        },
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("assistant");
    expect((events[0] as Record<string, unknown>).delta).toBe("partial text");
  });

  it("input_json_delta 工具调用增量", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: '{"key":' },
        },
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("tool_use");
    expect((events[0] as Record<string, unknown>).partial).toBe('{"key":');
  });

  it("tool_result 数组 content 格式化", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              content: [
                { type: "text", text: "Line 1" },
                { type: "text", text: "Line 2" },
              ],
              is_error: false,
            },
          ],
        },
      }) + "\n"
    );

    expect(events.length).toBe(1);
    expect((events[0] as Record<string, unknown>).content).toBe("Line 1\nLine 2");
  });

  it("Buffer 输入", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    const json = JSON.stringify({ type: "system", subtype: "init" }) + "\n";
    parser.feed(Buffer.from(json, "utf-8"));

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("system");
  });

  it("未识别的类型不发出事件（默认）", () => {
    const parser = new JsonlParser();
    const events: JsonlEvent[] = [];
    parser.on("event", (e: JsonlEvent) => events.push(e));

    parser.feed(JSON.stringify({ type: "unknown_type", data: 123 }) + "\n");

    expect(events.length).toBe(0);
  });
});
