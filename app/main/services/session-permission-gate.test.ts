import { describe, expect, it, vi } from "vitest";
import { createWithPermissionGate, withSessionCreationLock } from "./session-permission-gate";

/**
 * 会话创建期间权限切换的竞态（Pi 原生扩展集成方案 · 复查待修清单 #2）。
 *
 * 旧实现：以 full 开始异步创建，期间切到 standard——session-cache:write 的
 * schedulePermissionToolRebuild 找不到尚未登记的活跃会话直接返回，创建完成的
 * 会话仍带着扩展运行。门禁在登记前复核实时模式并弃用重建。
 */
describe("createWithPermissionGate 会话创建权限门禁", () => {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it("full 开始创建、创建期间写入 standard → 弃用旧会话按 standard 重建", async () => {
    let liveMode: string | undefined = "full";
    const first = deferred<string>();
    const created: Array<{ mode: string | undefined; id: string }> = [];
    const disposed: string[] = [];
    const create = vi.fn((mode: string | undefined) => {
      const id = `session-${created.length + 1}`;
      created.push({ mode, id });
      return created.length === 1 ? first.promise : Promise.resolve(id);
    });
    const onStale = vi.fn();
    const pending = createWithPermissionGate<string>({
      initialMode: "full",
      readLiveMode: () => liveMode,
      create,
      dispose: async (stale) => { disposed.push(stale); },
      onStale,
    });
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    // 暂停期写入 standard（模拟 session-cache:write 已提交），再放行创建
    liveMode = "standard";
    first.resolve("session-1");
    await expect(pending).resolves.toBe("session-2");
    expect(disposed).toEqual(["session-1"]);
    expect(created.map((entry) => entry.mode)).toEqual(["full", "standard"]);
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it("覆盖恢复会话场景：恢复期间切档同样弃用重建", async () => {
    let liveMode: string | undefined = "full";
    const first = deferred<string>();
    const disposed: string[] = [];
    let calls = 0;
    const pending = createWithPermissionGate<string>({
      initialMode: "full",
      readLiveMode: () => liveMode,
      create: (mode) => (++calls === 1 ? first.promise : Promise.resolve(`resumed-${mode}`)),
      dispose: async (stale) => { disposed.push(stale); },
    });
    await vi.waitFor(() => expect(calls).toBe(1));
    liveMode = "readonly";
    first.resolve("stale-resume");
    await expect(pending).resolves.toBe("resumed-readonly");
    expect(disposed).toEqual(["stale-resume"]);
  });

  it("模式保持 full → 不重建、不弃用", async () => {
    const dispose = vi.fn();
    const result = await createWithPermissionGate<string>({
      initialMode: "full",
      readLiveMode: () => "full",
      create: async () => "session",
      dispose,
    });
    expect(result).toBe("session");
    expect(dispose).not.toHaveBeenCalled();
  });

  it("非 full 开始创建 → 创建期间的模式波动不触发重建（放宽方向不补载扩展）", async () => {
    let liveMode: string | undefined = "standard";
    const first = deferred<string>();
    const dispose = vi.fn();
    let calls = 0;
    const pending = createWithPermissionGate<string>({
      initialMode: "standard",
      readLiveMode: () => liveMode,
      create: async () => { calls++; return first.promise; },
      dispose,
    });
    await vi.waitFor(() => expect(calls).toBe(1));
    liveMode = "full";
    first.resolve("session");
    await expect(pending).resolves.toBe("session");
    expect(calls).toBe(1);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("重建期间进一步收紧（full → standard → readonly）→ 以最终模式收尾且只重建一次", async () => {
    let liveMode: string | undefined = "full";
    const gates = [deferred<string>(), deferred<string>()];
    const modes: Array<string | undefined> = [];
    const disposed: string[] = [];
    let calls = 0;
    const pending = createWithPermissionGate<string>({
      initialMode: "full",
      readLiveMode: () => liveMode,
      create: (mode) => { modes.push(mode); return gates[calls++]!.promise; },
      dispose: async (stale) => { disposed.push(stale); },
    });
    await vi.waitFor(() => expect(calls).toBe(1));
    liveMode = "standard";
    gates[0]!.resolve("first");
    await vi.waitFor(() => expect(calls).toBe(2));
    liveMode = "readonly";
    gates[1]!.resolve("second");
    // 第二次创建按 standard 进行，期间的 standard → readonly 不触发再重建（无扩展加载）
    await expect(pending).resolves.toBe("second");
    expect(modes).toEqual(["full", "standard"]);
    expect(disposed).toEqual(["first"]);
  });
});

describe("withSessionCreationLock 会话创建互斥锁", () => {
  it("创建持锁期间到达的权限提交排队到创建完成后才执行（顺序：工厂 → 登记 → 提交）", async () => {
    const events: string[] = [];
    // 模拟 sendMessage 的「创建+登记」段持锁：内部在「扩展工厂执行」后暂停（模拟登记前的 await）
    let releaseRegistration!: () => void;
    const registrationGate = new Promise<void>((resolve) => { releaseRegistration = resolve; });
    const creating = withSessionCreationLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0)); // 模拟 loader 内部 import
      events.push("factory");                                  // reload 内工厂执行（提交被锁挡住，此时仍是 full）
      await registrationGate;                                  // 模拟登记前的其它 await
      events.push("registered");
      return "session";
    });
    await vi.waitFor(() => expect(events).toContain("factory"));
    // 创建中途到达的切档提交（模拟 session-cache:write 带 permissionMode）
    const committing = withSessionCreationLock(async () => {
      events.push("commit-standard");
    });
    // 提交已发起但被锁挡住：登记完成前不生效
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(["factory"]);
    releaseRegistration();
    await expect(creating).resolves.toBe("session");
    await expect(committing).resolves.toBeUndefined();
    expect(events).toEqual(["factory", "registered", "commit-standard"]);
  });

  it("串行执行且异常不阻塞后续使用者", async () => {
    const order: number[] = [];
    const first = withSessionCreationLock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(1);
      throw new Error("boom");
    });
    await expect(first).rejects.toThrow("boom");
    await withSessionCreationLock(async () => { order.push(2); });
    expect(order).toEqual([1, 2]);
  });
});
