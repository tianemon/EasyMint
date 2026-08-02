/**
 * 结果收集器 — 治「逐词递增重复 / 空结果」的核心
 *
 * Pi 的 message_update 每帧携带累积全文快照 → 按消息 id 替换（不 push 拼接），
 * 与渲染层 replaceAiEntriesById 同一哲学；agent_end 的最终消息覆盖兜底。
 * 多 turn（工具循环后最终回复）的每条消息独立收集，最终 join = 每 turn 一条完整文本。
 */

import type { AgentSessionEvent } from "../pi-sdk";
import { assembleYieldResult, arrayValuedLabels } from "./yield-assembly";
import type { StructuredSubagentOutput, YieldItem } from "./types";

interface AssistantMessageLike {
  id?: string;
  role?: string;
  content?: Array<{ type?: string; text?: string; thinking?: string }>;
}

/** 提取 assistant 消息的文本内容（content 块的 text 拼接） */
function extractText(msg: AssistantMessageLike): string {
  if (!Array.isArray(msg.content)) return "";
  const parts: string[] = [];
  for (const b of msg.content) {
    if (b.type === "text" && b.text) parts.push(b.text);
  }
  return parts.join("\n");
}

function isAssistant(msg: unknown): msg is AssistantMessageLike {
  if (!msg || typeof msg !== "object") return false;
  return (msg as { role?: string }).role === "assistant";
}

export class ResultCollector {
  /** 消息 id → 该消息最新累积文本（每帧替换） */
  private byMsgId = new Map<string, string>();
  /** 保持消息出现顺序 */
  private order: string[] = [];

  /** 订阅回调入口：message_update / message_end / agent_end */
  onEvent(event: AgentSessionEvent): void {
    if ((event.type === "message_update" || event.type === "message_end") && isAssistant(event.message)) {
      this.replace(event.message);
      return;
    }
    if (event.type === "agent_end" && Array.isArray(event.messages)) {
      // 最终消息覆盖兜底（避免依赖 message_end 竞态）
      for (const m of event.messages) {
        if (isAssistant(m)) this.replace(m);
      }
    }
  }

  private replace(msg: AssistantMessageLike): void {
    const text = extractText(msg);
    if (!text) return;
    const id = msg.id ?? "last";
    if (!this.byMsgId.has(id)) this.order.push(id);
    this.byMsgId.set(id, text);
  }

  /** 全部消息文本（每条消息一条完整文本，无重复） */
  getText(): string {
    return this.order.map((id) => this.byMsgId.get(id) ?? "").filter(Boolean).join("\n\n");
  }

  /** 结构化输出组装（yield 工具收集项 → schema 化 payload） */
  buildStructuredOutput(
    yieldItems: YieldItem[],
    outputSchema?: unknown,
  ): StructuredSubagentOutput | undefined {
    if (!outputSchema || yieldItems.length === 0) return undefined;
    const assembled = assembleYieldResult(yieldItems, this.getText(), arrayValuedLabels(outputSchema));
    if (!assembled) return undefined;
    return {
      status: "valid",
      data: assembled.data,
      error: assembled.missingData ? "部分 yield 缺少 data" : undefined,
    };
  }
}
