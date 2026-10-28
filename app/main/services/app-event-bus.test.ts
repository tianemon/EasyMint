import { describe, expect, it, vi } from "vitest";
import { appEventBus } from "./app-event-bus";

describe("appEventBus", () => {
  it("给所有消费者发布同一份带递增序号的事件", () => {
    const listener = vi.fn();
    const unsubscribe = appEventBus.subscribe(listener);
    const first = appEventBus.publish("agent:test", { value: 1 });
    const second = appEventBus.publish("agent:test", { value: 2 });
    unsubscribe();
    appEventBus.publish("agent:test", { value: 3 });

    expect(second.sequence).toBe(first.sequence + 1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, first);
    expect(listener).toHaveBeenNthCalledWith(2, second);
  });

  it("可以按游标补发事件", () => {
    const cursor = appEventBus.currentSequence();
    const first = appEventBus.publish("remote:a", { value: 1 });
    appEventBus.publish("remote:b", { value: 2 });

    expect(appEventBus.eventsAfter(cursor, (event) => event.channel === "remote:a"))
      .toEqual([first]);
  });
});

describe("appEventBus 环形缓冲按字节限流", () => {
  it("单条超大事件不入缓冲，游标早于它时拒绝补发", () => {
    const cursor = appEventBus.currentSequence();
    const huge = appEventBus.publish("agent:stream", { content: "x".repeat(5 * 1024 * 1024) });

    expect(appEventBus.eventsAfter(cursor)).toBeNull();
    expect(appEventBus.eventsAfter(huge.sequence)).toEqual([]);
  });

  it("总字节超上限时淘汰最旧事件，仍在预算内的游标可补发", () => {
    const cursor = appEventBus.currentSequence();
    for (let i = 0; i < 20; i += 1) {
      appEventBus.publish("agent:stream", { content: "y".repeat(1024 * 1024) });
    }

    expect(appEventBus.eventsAfter(cursor)).toBeNull();
    expect(appEventBus.eventsAfter(appEventBus.currentSequence() - 1)?.length).toBe(1);
  });
});

describe("appEventBus 丢弃事件的补发范围", () => {
  const pickSession = (sessionId: string) => (event: { channel: string; data: unknown }) => {
    const data = event.data as { sessionId?: string } | undefined;
    return event.channel === "agent:stream" && data?.sessionId === sessionId;
  };

  it("同一会话的超大事件只让该会话拒绝补发，其它会话照常补发", () => {
    const cursor = appEventBus.currentSequence();
    appEventBus.publish("agent:stream", { sessionId: "sess-a", content: "z".repeat(5 * 1024 * 1024) });
    appEventBus.publish("agent:stream", { sessionId: "sess-b", content: "small" });

    expect(appEventBus.eventsAfter(cursor, pickSession("sess-a"))).toBeNull();
    expect(appEventBus.eventsAfter(cursor, pickSession("sess-b"))?.length).toBe(1);
  });

  it("不带筛选的补发仍按最严格口径处理（游标之后有丢弃即拒绝）", () => {
    const cursor = appEventBus.currentSequence();
    appEventBus.publish("agent:stream", { sessionId: "sess-c", content: "w".repeat(5 * 1024 * 1024) });

    expect(appEventBus.eventsAfter(cursor)).toBeNull();
  });
});
