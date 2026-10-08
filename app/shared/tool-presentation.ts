export interface PermissionBlock {
  kind: "permission_denied";
  rule: string;
  mode: string;
  operation: string;
  target: string;
  detail: string;
}

export type ToolPresentation = PermissionBlock | { kind: "edit_diff"; diff: string };
const PERMISSION_MARKER = "[EASYMINT_PERMISSION]";

function permissionBlock(value: unknown): PermissionBlock | undefined {
  if (!value || typeof value !== "object") return undefined;
  const block = value as Record<string, unknown>;
  if (block.kind !== "permission_denied" || !["rule", "mode", "operation", "target", "detail"].every(key => typeof block[key] === "string")) return undefined;
  return block as unknown as PermissionBlock;
}

// The SDK converts thrown errors to text. Keep stable metadata in the text envelope
// so live events, persisted SDK sessions, and subagent results retain the rule ID.
export function permissionErrorText(block: PermissionBlock, message: string): string {
  return `${PERMISSION_MARKER}${JSON.stringify(block)}\n${message}`;
}

export function toolPresentation(content: string | undefined, details?: unknown, isError = true): ToolPresentation | undefined {
  if (details && typeof details === "object") {
    const data = details as Record<string, unknown>;
    const block = permissionBlock(data.presentation);
    if (block) return block;
    if (typeof data.diff === "string") return { kind: "edit_diff", diff: data.diff };
  }
  if (!content) return undefined;
  if (content.startsWith(PERMISSION_MARKER)) {
    const line = content.slice(PERMISSION_MARKER.length).split("\n", 1)[0]!;
    try {
      const block = permissionBlock(JSON.parse(line));
      if (block) return block;
    } catch { /* A malformed third-party result remains ordinary visible output. */ }
  }
  // Old sessions retain their original text; only this adapter knows legacy labels.
  if (isError && content.includes("操作被阻止：")) {
    const legacy = content.slice(content.indexOf("操作被阻止："));
    const rule = /^规则：(.*)$/m.exec(legacy)?.[1];
    const storedMode = /^模式：(.*)$/m.exec(legacy)?.[1] ?? "";
    const legacyModes: Record<string, string> = {
      "只读": "readonly", "标准": "standard", "完全访问": "full",
      "自动": "standard", "受限": "readonly", auto: "standard", restricted: "readonly", sandbox: "readonly",
    };
    if (rule) return {
      kind: "permission_denied", rule,
      mode: legacyModes[storedMode] ?? storedMode,
      operation: /^操作：(.*)$/m.exec(legacy)?.[1] ?? "",
      target: /^目标：(.*)$/m.exec(legacy)?.[1] ?? "",
      detail: legacy.split("\n", 1)[0]!.slice("操作被阻止：".length),
    };
  }
  const marker = "\n\n变更内容:\n";
  const index = content.indexOf(marker);
  if (index >= 0) return { kind: "edit_diff", diff: content.slice(index + marker.length) };
  return undefined;
}

export function diffBody(content: string, presentation?: ToolPresentation): string {
  const value = presentation ?? toolPresentation(content);
  return value?.kind === "edit_diff" ? value.diff : content;
}

export function protectionRule(content: string | undefined, presentation?: ToolPresentation): string | undefined {
  const value = presentation ?? toolPresentation(content);
  return value?.kind === "permission_denied" ? value.rule : undefined;
}

export function toolResultForUi(content: string, details?: unknown, isError = true): { content: string; presentation?: ToolPresentation } {
  const presentation = toolPresentation(content, details, isError);
  return {
    content: content.startsWith(PERMISSION_MARKER) && presentation?.kind === "permission_denied"
      ? content.slice(content.indexOf("\n") + 1) : content,
    presentation,
  };
}

// Keep the existing human-readable content field compatible with older clients.
// Metadata stays in details; the original SDK session record is never rewritten.
export function toolMessageForUi(message: Record<string, unknown>): Record<string, unknown> {
  if (message.role !== "toolResult" || !Array.isArray(message.content)) return message;
  let presentation: ToolPresentation | undefined;
  const content = message.content.map((item: unknown) => {
    if (!item || typeof item !== "object") return item;
    const block = item as Record<string, unknown>;
    if (block.type !== "text" || typeof block.text !== "string") return item;
    const value = toolResultForUi(block.text, message.details, message.isError === true);
    if (value.content === block.text) return item;
    presentation = value.presentation;
    return { ...block, text: value.content };
  });
  if (!presentation) return message;
  const details = message.details && typeof message.details === "object" ? message.details : {};
  return { ...message, content, details: { ...details, presentation } };
}
