import { describe, expect, it } from "vitest";
import { isPermissionModeTightening, normalizePermissionMode } from "./permission/execution-context";
import { createDelegation, getOwnedSessionIds } from "./task/registry";

describe("权限模式收紧", () => {
  it("覆盖 full → standard/readonly 与 standard → readonly", () => {
    expect(isPermissionModeTightening("full", "standard")).toBe(true);
    expect(isPermissionModeTightening("bypassPermissions", "readonly")).toBe(true);
    expect(isPermissionModeTightening("standard", "readonly")).toBe(true);
    expect(isPermissionModeTightening("readonly", "standard")).toBe(false);
    expect(isPermissionModeTightening("standard", "full")).toBe(false);
    expect(isPermissionModeTightening(undefined, "readonly")).toBe(false);
  });

  it("旧模式名称和缺省值统一归一", () => {
    expect(normalizePermissionMode("restricted")).toBe("readonly");
    expect(normalizePermissionMode("sandbox")).toBe("readonly");
    expect(normalizePermissionMode("bypassPermissions")).toBe("full");
    expect(normalizePermissionMode(undefined)).toBe("standard");
  });
});

describe("父子会话进程所有权", () => {
  it("主会话拥有子会话，子会话不反向拥有主会话或兄弟会话", () => {
    const parent = `parent-${Date.now()}`;
    const record = createDelegation(parent, []);
    record.childSessionIds.push(`${parent}-child-a`, `${parent}-child-b`);

    expect(getOwnedSessionIds(parent)).toEqual(new Set([parent, `${parent}-child-a`, `${parent}-child-b`]));
    expect(getOwnedSessionIds(`${parent}-child-a`)).toEqual(new Set([`${parent}-child-a`]));
  });
});
