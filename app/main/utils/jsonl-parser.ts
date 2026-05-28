import { EventEmitter } from "events";
import { Readable } from "stream";

export interface JsonlEvent {
  type: "assistant" | "tool_use" | "tool_result" | "system" | "result" | "error" | "raw";
  [key: string]: unknown;
}

export interface JsonlParserOptions {
  /** 是否保留未分类的原始 JSON 行（raw 事件），默认 false */
  emitRaw?: boolean;
}

export class JsonlParser extends EventEmitter {
  private buffer = "";
  private stream: Readable | null = null;
  private readonly emitRaw: boolean;

  constructor(options: JsonlParserOptions = {}) {
    super();
    this.emitRaw = options.emitRaw ?? false;
  }

  /** 从 Readable stream 开始解析 */
  start(stream: Readable): void {
    this.stream = stream;
    stream.setEncoding("utf-8");
    stream.on("data", (chunk: string) => this.feed(chunk));
    stream.on("end", () => this.flush());
  }

  /** 从 Buffer/String 批量输入（用于测试或手动推送） */
  feed(chunk: string | Buffer): void {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");

    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      this.processLine(line);
    }
  }

  /** 停止解析，移除 stream 监听器 */
  stop(): void {
    if (this.stream) {
      this.stream.removeAllListeners("data");
      this.stream.removeAllListeners("end");
      this.stream = null;
    }
    this.buffer = "";
  }

  /** 清空缓冲区中剩余的行（子进程退出时调用） */
  flush(): void {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (!remaining) return;
    this.processLine(remaining);
  }

  private processLine(line: string): void {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      if (this.emitRaw) {
        this.emit("event", { type: "raw", line } as JsonlEvent);
      }
      return;
    }

    const result = this.classify(obj);
    if (result) {
      if (Array.isArray(result)) {
        for (const event of result) {
          this.emit("event", event);
        }
      } else {
        this.emit("event", result);
      }
    }
  }

  private classify(obj: Record<string, unknown>): JsonlEvent | JsonlEvent[] | null {
    // system 事件（init、status 等）
    if (obj.type === "system") {
      return {
        type: "system",
        subtype: obj.subtype,
        ...this.pickExtra(obj),
      };
    }

    // stream_event 包含增量内容
    if (obj.type === "stream_event" && isRecord(obj.event)) {
      return this.classifyStreamEvent(obj.event as Record<string, unknown>);
    }

    // assistant 包装消息（content blocks 完成信号）
    if (obj.type === "assistant" && isRecord(obj.message)) {
      return this.classifyAssistant(obj.message as Record<string, unknown>);
    }

    // user 消息（通常包含 tool_result）
    if (obj.type === "user" && isRecord(obj.message)) {
      return this.classifyUser(obj.message as Record<string, unknown>);
    }

    // result 消息（usage、cost、stop_reason）
    if (obj.type === "result") {
      return {
        type: "result",
        usage: obj.usage ?? null,
        costUsd: obj.total_cost_usd ?? null,
        durationMs: obj.duration_ms ?? null,
        stopReason: obj.stop_reason ?? null,
        ...this.pickExtra(obj, ["usage", "total_cost_usd", "duration_ms", "stop_reason"]),
      };
    }

    // 未识别的类型，跳过或发 raw
    if (this.emitRaw) {
      return { type: "raw", raw: obj };
    }
    return null;
  }

  private classifyStreamEvent(ev: Record<string, unknown>): JsonlEvent | null {
    if (ev.type === "content_block_delta" && isRecord(ev.delta)) {
      const delta = ev.delta as Record<string, unknown>;
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        return { type: "assistant", delta: delta.text };
      }
      if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        return {
          type: "tool_use",
          partial: delta.partial_json,
        };
      }
    }

    if (ev.type === "content_block_start" && isRecord(ev.content_block)) {
      const block = ev.content_block as Record<string, unknown>;
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: null,
          started: true,
        };
      }
    }

    return null;
  }

  private classifyAssistant(msg: Record<string, unknown>): JsonlEvent | JsonlEvent[] | null {
    if (!Array.isArray(msg.content)) return null;

    const events: JsonlEvent[] = [];
    const textParts: string[] = [];

    for (const block of msg.content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      } else if (block.type === "tool_use") {
        events.push({
          type: "tool_use" as const,
          id: block.id,
          name: block.name,
          input: block.input ?? null,
          started: false,
        });
      }
    }

    if (textParts.length > 0) {
      events.unshift({
        type: "assistant",
        delta: textParts.join(""),
        stopReason: msg.stop_reason ?? null,
      });
    }

    return events.length > 0 ? (events.length === 1 ? events[0] : events) : null;
  }

  private classifyUser(msg: Record<string, unknown>): JsonlEvent | null {
    if (!Array.isArray(msg.content)) return null;

    for (const block of msg.content) {
      if (!isRecord(block)) continue;
      if (block.type === "tool_result") {
        return {
          type: "tool_result",
          toolUseId: block.tool_use_id,
          content: formatToolContent(block.content),
          isError: Boolean(block.is_error),
        };
      }
    }

    return null;
  }

  private pickExtra(obj: Record<string, unknown>, exclude: string[] = []): Record<string, unknown> {
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (!exclude.includes(key) && !["type", "subtype"].includes(key)) {
        extra[key] = obj[key];
      }
    }
    return extra;
  }
}

// --- event type helpers ---

export function isAssistantEvent(e: JsonlEvent): e is JsonlEvent & { type: "assistant" } {
  return e.type === "assistant";
}

export function isToolUseEvent(e: JsonlEvent): e is JsonlEvent & { type: "tool_use" } {
  return e.type === "tool_use";
}

export function isToolResultEvent(e: JsonlEvent): e is JsonlEvent & { type: "tool_result" } {
  return e.type === "tool_result";
}

export function isSystemEvent(e: JsonlEvent): e is JsonlEvent & { type: "system" } {
  return e.type === "system";
}

export function isResultEvent(e: JsonlEvent): e is JsonlEvent & { type: "result" } {
  return e.type === "result";
}

// --- internal helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (isRecord(c) && c.type === "text" ? String(c.text) : JSON.stringify(c)))
      .join("\n");
  }
  return JSON.stringify(content);
}
