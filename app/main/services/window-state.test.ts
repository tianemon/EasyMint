import { describe, expect, it } from "vitest";
import { normalizeWindowState, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from "./window-state";

const mainDisplay = { x: 0, y: 0, width: 1920, height: 1080 };

describe("normalizeWindowState 窗口状态校验", () => {
  it("完整记录原样通过（含最大化标记）", () => {
    const state = normalizeWindowState(
      { x: 120, y: 80, width: 1400, height: 900, maximized: true },
      [mainDisplay],
    );
    expect(state).toEqual({ x: 120, y: 80, width: 1400, height: 900, maximized: true });
  });

  it("缺字段或非有限数字 → 视为无记录", () => {
    expect(normalizeWindowState(null, [mainDisplay])).toBeNull();
    expect(normalizeWindowState("1400x900", [mainDisplay])).toBeNull();
    expect(normalizeWindowState({ x: 0, y: 0, width: 1400 }, [mainDisplay])).toBeNull();
    expect(normalizeWindowState({ x: "0", y: 0, width: 1400, height: 900 }, [mainDisplay])).toBeNull();
    expect(normalizeWindowState({ x: Number.NaN, y: 0, width: 1400, height: 900 }, [mainDisplay])).toBeNull();
  });

  it("尺寸小于窗口下限时夹到下限", () => {
    const state = normalizeWindowState({ x: 40, y: 40, width: 300, height: 200, maximized: false }, [mainDisplay]);
    expect(state).toMatchObject({ width: WINDOW_MIN_WIDTH, height: WINDOW_MIN_HEIGHT });
  });

  it("坐标落在所有屏幕之外 → 视为无记录（拔掉外接屏后不把窗口丢在屏幕外）", () => {
    expect(normalizeWindowState({ x: 5000, y: 5000, width: 1400, height: 900 }, [mainDisplay])).toBeNull();
    expect(normalizeWindowState({ x: -3000, y: 0, width: 1400, height: 900 }, [mainDisplay])).toBeNull();
    expect(normalizeWindowState({ x: 0, y: 2000, width: 1400, height: 900 }, [mainDisplay])).toBeNull();
  });

  it("外接屏上的记录按那块屏校验（多显示器不误判为屏幕外）", () => {
    const external = { x: 1920, y: 0, width: 2560, height: 1440 };
    const state = normalizeWindowState({ x: 2400, y: 200, width: 1600, height: 1000 }, [mainDisplay, external]);
    expect(state).toMatchObject({ x: 2400, y: 200 });
    // 同一坐标在没有这块屏时不成立
    expect(normalizeWindowState({ x: 2400, y: 200, width: 1600, height: 1000 }, [mainDisplay])).toBeNull();
  });

  it("与屏幕只有少量重叠仍算可见（保留贴边摆放）", () => {
    const state = normalizeWindowState({ x: 1800, y: 0, width: 1400, height: 900 }, [mainDisplay]);
    expect(state).toMatchObject({ x: 1800, y: 0 });
  });

  it("maximized 非布尔值 → 按未最大化处理", () => {
    expect(normalizeWindowState({ x: 0, y: 0, width: 1400, height: 900, maximized: "yes" }, [mainDisplay]))
      .toMatchObject({ maximized: false });
    expect(normalizeWindowState({ x: 0, y: 0, width: 1400, height: 900 }, [mainDisplay]))
      .toMatchObject({ maximized: false });
  });
});
