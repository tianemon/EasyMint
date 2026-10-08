import { describe, expect, it, vi } from "vitest";
import { diffBody, permissionErrorText, protectionRule, toolPresentation, toolMessageForUi, type PermissionBlock } from "../../shared/tool-presentation";
import { wrapToolWithPermission } from "./permission/wrap-tool";
import { bridgeSessionEvents } from "./event-bridge";

const block: PermissionBlock = { kind: "permission_denied", rule: "standard.write_scope", mode: "standard", operation: "write", target: "/tmp/用户文件.txt", detail: "写入工作区外文件" };

describe("locale-independent tool results", () => {
  it("uses structured diffs even when the result text is in another language", () => {
    const diff = "@@ -1 +1 @@\n-原文\n+用户的新内容";
    const presentation = toolPresentation("Changes applied", { diff });
    expect(presentation).toEqual({ kind: "edit_diff", diff });
    expect(diffBody("Changes applied", presentation)).toBe(diff);
  });

  it("preserves the full diff in old sessions, including repeated legacy markers inside code", () => {
    const diff = "+const x = '变更内容:';\n+第二行";
    expect(diffBody(`Successfully edited\n\n变更内容:\n${diff}`)).toBe(diff);
  });

  it("retains permission metadata through the SDK text error envelope and refuses execution", async () => {
    const execute = vi.fn();
    const tool = wrapToolWithPermission({ name: "write", execute }, {
      canUseTool: async () => ({ behavior: "deny", message: "Denied in any language", block }),
    });
    let message = "";
    try { await tool.execute("call", {}, undefined); } catch (error) { message = (error as Error).message; }
    expect(execute).not.toHaveBeenCalled();
    expect(toolPresentation(message)).toEqual(block);
    expect(protectionRule(message)).toBe("standard.write_scope");
  });

  it("supports historical permission messages without rewriting their stored text", () => {
    const legacy = "操作被阻止：写入工作区外文件\n模式：标准\n操作：write\n目标：/tmp/a\n规则：standard.write_scope\n阶段：执行前";
    expect(protectionRule(legacy)).toBe("standard.write_scope");
    expect(toolPresentation(legacy)).toMatchObject({ target: "/tmp/a", detail: "写入工作区外文件" });
  });

  it("keeps malformed or unrelated output visible as ordinary text", () => {
    for (const content of ["[EASYMINT_PERMISSION]not json", "[EASYMINT_PERMISSION]{\"kind\":\"permission_denied\"}", "User content: 操作被阻止：example"]) {
      expect(toolPresentation(content)).toBeUndefined();
      expect(diffBody(content)).toBe(content);
    }
  });

  it("keeps live content compatible with older clients while sending metadata separately", () => {
    const onEvent = vi.fn();
    const raw = permissionErrorText(block, "操作被阻止：写入工作区外文件");
    bridgeSessionEvents({ type: "message_start", message: { role: "toolResult", toolCallId: "p1", toolName: "write", content: [{ type: "text", text: raw }], isError: true } } as never, { onEvent } as never);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ content: "操作被阻止：写入工作区外文件", presentation: block, isError: true }));
  });

  it("normalizes historical view data without modifying SDK records or user messages", () => {
    const raw = { role: "toolResult", content: [{ type: "text", text: permissionErrorText(block, "original human message") }], details: { other: "keep" } };
    const view = toolMessageForUi(raw);
    expect(view.content).toEqual([{ type: "text", text: "original human message" }]);
    expect(view.details).toEqual({ other: "keep", presentation: block });
    expect(raw.content[0]!.text).toContain("[EASYMINT_PERMISSION]");
    const user = { ...raw, role: "user" };
    expect(toolMessageForUi(user)).toBe(user);
  });

  it("propagates metadata through the live event bridge", () => {
    const onEvent = vi.fn();
    bridgeSessionEvents({ type: "message_start", message: { role: "toolResult", toolCallId: "t1", toolName: "edit", content: [{ type: "text", text: "Done" }], details: { diff: "+原文" }, isError: false } } as never, { onEvent } as never);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "tool_result", toolCallId: "t1", presentation: { kind: "edit_diff", diff: "+原文" } }));
  });
});
