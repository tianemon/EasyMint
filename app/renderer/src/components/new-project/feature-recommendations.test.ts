import { describe, expect, it } from "vitest";
import { applyFeatureRecommendations, emptyFeatureRows } from "./feature-recommendations";

const rows = (...names: string[]) => names.map(name => ({ name }));
describe("feature recommendation merge", () => {
  it("fills empty slots instead of appending below blank input rows", () => {
    expect(applyFeatureRecommendations(emptyFeatureRows(), rows("账单", "分类", "导出", "同步")))
      .toEqual(rows("账单", "分类", "导出", "同步"));
    expect(applyFeatureRecommendations(emptyFeatureRows(), rows("账单", "分类")))
      .toEqual(rows("账单", "分类", ""));
  });
  it("keeps user text and order, appending new recommendations below it", () => {
    const original = rows("  My own feature  ", "", "手动输入");
    const before = structuredClone(original);
    expect(applyFeatureRecommendations(original, rows("新建议", "my own feature", "新建议", "手动输入")))
      .toEqual(rows("  My own feature  ", "手动输入", "新建议"));
    expect(original).toEqual(before);
  });
  it("respects input typed while a recommendation was in flight", () => {
    const currentAtReply = rows("刚刚补充的功能", "", "");
    expect(applyFeatureRecommendations(currentAtReply, rows("建议一", "建议二")))
      .toEqual(rows("刚刚补充的功能", "建议一", "建议二"));
  });
  it("keeps user duplicates but removes blank or duplicate recommendations", () => {
    expect(applyFeatureRecommendations(rows("A", "A"), rows(" ", "a", "B", "b"))).toEqual(rows("A", "A", "B"));
  });
  it("creates independent blank rows", () => {
    const result = emptyFeatureRows();
    expect(result).toHaveLength(3);
    result[0]!.name = "edited";
    expect(result[1]!.name).toBe("");
  });
});
