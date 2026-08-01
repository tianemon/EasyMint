import { describe, it, expect, beforeEach } from "vitest";
import { usePinStore } from "./pin-store";

describe("pin-store", () => {
  beforeEach(() => {
    usePinStore.setState({ pinsBySession: {} });
  });

  it("addPin 生成 id/title/未定位坐标", () => {
    usePinStore.getState().addPin("s1", "## 需求总结\n1. xxx");
    const pins = usePinStore.getState().pinsBySession["s1"]!;
    expect(pins).toHaveLength(1);
    expect(pins[0]!.title).toBe("需求总结");
    expect(pins[0]!.x).toBe(-1);
    expect(pins[0]!.y).toBe(-1);
    expect(pins[0]!.id).toMatch(/^pin_/);
  });

  it("addPin 空内容兜底标题为「便签」", () => {
    usePinStore.getState().addPin("s1", "\n\n");
    expect(usePinStore.getState().pinsBySession["s1"]![0]!.title).toBe("便签");
  });

  it("addPin 标题去掉 Markdown 符号并截断 20 字", () => {
    usePinStore.getState().addPin("s1", "# **这是一个非常非常非常非常非常非常长的标题内容**");
    const title = usePinStore.getState().pinsBySession["s1"]![0]!.title;
    expect(title.length).toBeLessThanOrEqual(20);
    expect(title).not.toContain("#");
    expect(title).not.toContain("*");
  });

  it("removePin 删除指定便签", () => {
    usePinStore.getState().addPin("s1", "aaa");
    usePinStore.getState().addPin("s1", "bbb");
    const id = usePinStore.getState().pinsBySession["s1"]![0]!.id;
    usePinStore.getState().removePin("s1", id);
    const pins = usePinStore.getState().pinsBySession["s1"]!;
    expect(pins).toHaveLength(1);
    expect(pins[0]!.content).toBe("bbb");
  });

  it("movePin 更新坐标", () => {
    usePinStore.getState().addPin("s1", "aaa");
    const id = usePinStore.getState().pinsBySession["s1"]![0]!.id;
    usePinStore.getState().movePin("s1", id, 100, 50);
    const pin = usePinStore.getState().pinsBySession["s1"]![0]!;
    expect(pin.x).toBe(100);
    expect(pin.y).toBe(50);
  });

  it("bringToFront 移到数组末尾", () => {
    usePinStore.getState().addPin("s1", "aaa");
    usePinStore.getState().addPin("s1", "bbb");
    usePinStore.getState().addPin("s1", "ccc");
    const firstId = usePinStore.getState().pinsBySession["s1"]![0]!.id;
    usePinStore.getState().bringToFront("s1", firstId);
    const pins = usePinStore.getState().pinsBySession["s1"]!;
    expect(pins).toHaveLength(3);
    expect(pins[2]!.id).toBe(firstId);
  });

  it("migrateSession 迁移临时 sid 数据到真实 sid", () => {
    usePinStore.getState().addPin("__new_xxx", "aaa");
    usePinStore.getState().migrateSession("__new_xxx", "real-sid");
    const state = usePinStore.getState().pinsBySession;
    expect(state["__new_xxx"]).toBeUndefined();
    expect(state["real-sid"]).toHaveLength(1);
  });

  it("migrateSession 目标已有数据时合并", () => {
    usePinStore.getState().addPin("__new_xxx", "新");
    usePinStore.getState().addPin("real-sid", "旧");
    usePinStore.getState().migrateSession("__new_xxx", "real-sid");
    const pins = usePinStore.getState().pinsBySession["real-sid"]!;
    expect(pins).toHaveLength(2);
    expect(pins[0]!.content).toBe("旧");
    expect(pins[1]!.content).toBe("新");
  });

  it("loadPins 加载会话便签", () => {
    const pins = [{ id: "p1", content: "c", title: "t", x: 10, y: 10, createdAt: 1 }];
    usePinStore.getState().loadPins("s1", pins);
    expect(usePinStore.getState().pinsBySession["s1"]).toEqual(pins);
  });

  it("会话间数据隔离", () => {
    usePinStore.getState().addPin("s1", "aaa");
    usePinStore.getState().addPin("s2", "bbb");
    expect(usePinStore.getState().pinsBySession["s1"]).toHaveLength(1);
    expect(usePinStore.getState().pinsBySession["s2"]).toHaveLength(1);
    expect(usePinStore.getState().pinsBySession["s1"]![0]!.content).toBe("aaa");
  });

  it("addPin 默认不含宽高（渲染层用默认 320/auto）", () => {
    usePinStore.getState().addPin("s1", "aaa");
    const pin = usePinStore.getState().pinsBySession["s1"]![0]!;
    expect(pin.width).toBeUndefined();
    expect(pin.height).toBeUndefined();
  });

  it("resizePin 更新宽高", () => {
    usePinStore.getState().addPin("s1", "aaa");
    const id = usePinStore.getState().pinsBySession["s1"]![0]!.id;
    usePinStore.getState().resizePin("s1", id, 400, 300);
    const pin = usePinStore.getState().pinsBySession["s1"]![0]!;
    expect(pin.width).toBe(400);
    expect(pin.height).toBe(300);
  });

  it("addPin 自动分配颜色索引（现存不重复）", () => {
    usePinStore.getState().addPin("s1", "a");
    usePinStore.getState().addPin("s1", "b");
    const pins = usePinStore.getState().pinsBySession["s1"]!;
    expect(pins[0]!.colorIdx).toBe(0);
    expect(pins[1]!.colorIdx).toBe(1);
  });

  it("addPin 颜色索引复用已释放的色号", () => {
    usePinStore.getState().addPin("s1", "a");
    usePinStore.getState().addPin("s1", "b");
    usePinStore.getState().removePin("s1", usePinStore.getState().pinsBySession["s1"]![0]!.id);
    usePinStore.getState().addPin("s1", "c");
    const pins = usePinStore.getState().pinsBySession["s1"]!;
    expect(pins).toHaveLength(2);
    expect(pins[1]!.colorIdx).toBe(0);
  });

  it("minimizePin 折叠为贴纸并清除坐标", () => {
    usePinStore.getState().addPin("s1", "a");
    const id = usePinStore.getState().pinsBySession["s1"]![0]!.id;
    usePinStore.getState().minimizePin("s1", id, "right");
    const pin = usePinStore.getState().pinsBySession["s1"]![0]!;
    expect(pin.minimized).toBe(true);
    expect(pin.edge).toBe("right");
    expect(pin.y).toBe(-1);
  });

  it("expandPin 展开为卡片并设置位置", () => {
    usePinStore.getState().addPin("s1", "a");
    const id = usePinStore.getState().pinsBySession["s1"]![0]!.id;
    usePinStore.getState().minimizePin("s1", id, "right");
    usePinStore.getState().expandPin("s1", id, 100, 50);
    const pin = usePinStore.getState().pinsBySession["s1"]![0]!;
    expect(pin.minimized).toBe(false);
    expect(pin.edge).toBeUndefined();
    expect(pin.x).toBe(100);
    expect(pin.y).toBe(50);
  });
});
