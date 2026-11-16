import { expect, it } from "vitest";
import { managePatch } from "./manage-patch";
import type { MemoryRecord } from "../../../shared/memory";

const base = { key: "global/x", id: "x", scope: "global", kind: "preference", confidence: "confirmed",
  lifecycle: "active", occurredAt: 0, updatedAt: 0, revision: 1, sources: [],
  text: "回答简洁", fingerprint: "f" } as unknown as MemoryRecord;

it("archive 进历史并清空摘要", () => {
  expect(managePatch("archive", base)).toEqual({ lifecycle: "archived", reason: "用户收进历史", summary: "" });
});

it("restore 解除合并并恢复生命周期", () => {
  expect(managePatch("restore", base)).toMatchObject({ unmerge: true, lifecycle: "active" });
  expect(managePatch("restore", { ...base, kind: "activity" } as MemoryRecord).lifecycle).toBe("archived");
});

it("restore 清掉已过期与未到生效的调度", () => {
  const now = 1_000;
  expect(managePatch("restore", { ...base, expiresAt: 500 } as MemoryRecord, undefined, now).expiresAt).toBeNull();
  expect(managePatch("restore", { ...base, effectiveAt: 2_000 } as MemoryRecord, undefined, now).effectiveAt).toBeNull();
  expect(managePatch("restore", { ...base, expiresAt: 2_000 } as MemoryRecord, undefined, now).expiresAt).toBeUndefined();
});

it("cancel 只取消计划，不改内容", () => {
  expect(managePatch("cancel", base)).toEqual({ cancelPending: true });
});

it("edit 必须带上新结论，且原样透传", () => {
  expect(() => managePatch("edit", base)).toThrow();
  const input = { kind: "preference", text: "回答更简洁" } as never;
  expect(managePatch("edit", base, input)).toBe(input);
});
