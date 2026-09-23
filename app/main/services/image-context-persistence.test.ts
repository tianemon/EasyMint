import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { contentWithoutImages, contextImageEntries } from "../../shared/image-context";
import { rollbackImageContextBranch } from "./image-context-rollback";

describe("SDK 图片上下文编辑", () => {
  it("保留原始聊天记录，重开后仍只把文字发给模型", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "easymint-image-context-"));
    try {
      const manager = SessionManager.create(dir, dir);
      const original = [
        { type: "text" as const, text: "[Image #1: /tmp/diagram.png] 请看图" },
        { type: "image" as const, data: "AAAA", mimeType: "image/png" },
      ];
      const entryId = manager.appendMessage({ role: "user", content: original, timestamp: Date.now() });
      const projected = manager.buildSessionProjection();
      expect(contextImageEntries(projected.entries)).toHaveLength(1);
      manager.appendContextEdit(entryId, { content: contentWithoutImages(original) as [{ type: "text"; text: string }] });
      // Pi flushes a newly created session to disk only after its first assistant entry.
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "已收到" }], timestamp: Date.now() } as Parameters<typeof manager.appendMessage>[0]);
      const file = manager.getSessionFile();
      expect(file).toBeTruthy();
      const reopened = SessionManager.open(file!, dir, dir);
      expect(contextImageEntries(reopened.buildSessionProjection().entries)).toHaveLength(0);
      expect((reopened.getEntry(entryId) as { message: { content: unknown[] } }).message.content).toEqual(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("失败回合撤回后先整理历史图再重发，重开不会留下两条提问", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "easymint-image-retry-"));
    try {
      const manager = SessionManager.create(dir, dir);
      const imageContent = [{ type: "text" as const, text: "[Image #1: /tmp/diagram.png]" }, { type: "image" as const, data: "AAAA", mimeType: "image/png" }];
      const imageId = manager.appendMessage({ role: "user", content: imageContent, timestamp: 1 });
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "已看图" }], timestamp: 2 } as Parameters<typeof manager.appendMessage>[0]);
      const failedId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "继续" }], timestamp: 3 });
      manager.appendMessage({ role: "assistant", content: [], timestamp: 4 } as unknown as Parameters<typeof manager.appendMessage>[0]);
      manager.branch(manager.getEntry(failedId)!.parentId!);
      manager.appendCustomEntry("em_rewind_pin", { leaf: failedId });
      manager.appendContextEdit(imageId, { content: contentWithoutImages(imageContent) as [{ type: "text"; text: string }] });
      manager.appendMessage({ role: "user", content: [{ type: "text", text: "继续" }], timestamp: 5 });
      const reopened = SessionManager.open(manager.getSessionFile()!, dir, dir);
      const context = reopened.buildSessionProjection();
      expect(contextImageEntries(context.entries)).toHaveLength(0);
      expect(context.messages.filter((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((block) => block.type === "text" && block.text === "继续"))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("自动压缩发生在失败提问之后时，按撤回后的分支列出会重新出现的图片", () => {
    const manager = SessionManager.inMemory("/tmp");
    const imageId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "图" }, { type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [], timestamp: 2 } as unknown as Parameters<typeof manager.appendMessage>[0]);
    const failedId = manager.appendMessage({ role: "user", content: [{ type: "text", text: "继续" }], timestamp: 3 });
    manager.appendCompaction("此前看过图片", failedId, 10);
    expect(contextImageEntries(manager.buildSessionProjection().entries)).toHaveLength(0);
    const branch = manager.getBranch();
    const failedIndex = branch.findIndex((entry) => entry.id === failedId);
    const preview = SessionManager.inMemory("/tmp", undefined, [manager.getHeader()!, ...branch.slice(0, failedIndex)]);
    expect(contextImageEntries(preview.buildSessionProjection().entries).map((entry) => entry.entryId)).toEqual([imageId]);
  });

  it("图片编辑中断后把原分支写回磁盘，重开仍能看到原图", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "easymint-image-rollback-"));
    try {
      const manager = SessionManager.create(dir, dir);
      const original = [{ type: "text" as const, text: "图" }, { type: "image" as const, data: "AAAA", mimeType: "image/png" }];
      const imageId = manager.appendMessage({ role: "user", content: original, timestamp: 1 });
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "收到" }], timestamp: 2 } as Parameters<typeof manager.appendMessage>[0]);
      const previousLeaf = manager.getLeafId();
      manager.appendContextEdit(imageId, { content: contentWithoutImages(original) as [{ type: "text"; text: string }] });
      expect(contextImageEntries(manager.buildSessionProjection().entries)).toHaveLength(0);
      expect(rollbackImageContextBranch({ sessionManager: manager, refreshContext: () => {} } as Parameters<typeof rollbackImageContextBranch>[0], previousLeaf)).toBe(true);
      const reopened = SessionManager.open(manager.getSessionFile()!, dir, dir);
      expect(contextImageEntries(reopened.buildSessionProjection().entries)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
