import { describe, expect, it } from "vitest";
import { placeSampleMenu } from "./sample-menu-position";
const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height });

describe("sample menu coordinates", () => {
  it("aligns a scaled trigger in artboard coordinates instead of using screen pixels", () => {
    const result = placeSampleMenu(rect(300, 200, 120, 20), rect(100, 50, 400, 320), rect(169, 75, 331, 295), { width: 800, height: 640 }, 110);
    expect(result).toEqual({ left: 400, top: 346, width: 240, maxHeight: 110, side: "bottom" });
  });
  it("flips above a field near the bottom, leaving the same six-pixel gap", () => {
    const result = placeSampleMenu(rect(180, 260, 160, 34), rect(0, 0, 360, 360), rect(0, 48, 360, 250), { width: 360, height: 360 }, 140)!;
    expect(result.side).toBe("top");
    expect(result.top + result.maxHeight).toBe(254);
    expect(result.width).toBe(160);
  });
  it("constrains the menu in a short viewport instead of clipping behind navigation", () => {
    const result = placeSampleMenu(rect(180, 100, 150, 44), rect(0, 0, 360, 250), rect(0, 48, 360, 140), { width: 360, height: 250 }, 160)!;
    expect(result.top).toBeGreaterThanOrEqual(56);
    expect(result.top + result.maxHeight).toBeLessThanOrEqual(180);
    expect(result.maxHeight).toBeLessThan(160);
    expect(result.left + result.width).toBeLessThanOrEqual(352);
  });
  it("closes when the trigger scrolls out and ignores an unmeasured artboard", () => {
    expect(placeSampleMenu(rect(20, 300, 100, 34), rect(0, 0, 360, 250), rect(0, 48, 360, 140), { width: 360, height: 250 }, 110)).toBeNull();
    expect(placeSampleMenu(rect(20, 80, 100, 34), rect(0, 0, 0, 0), rect(0, 48, 360, 140), { width: 360, height: 250 }, 110)).toBeNull();
  });
});
