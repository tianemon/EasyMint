import { describe, expect, it } from "vitest";
import { contextMenuPosition } from "./ContextMenu";

describe("context menu positioning with longer localized labels", () => {
  it("uses measured width and height rather than a fixed allowance", () => {
    const position = contextMenuPosition(795, 590, 350, 200, 800, 600);
    expect(position).toEqual({ left: 446, top: 396 });
    expect(position.left + 350).toBeLessThan(800);
    expect(position.top + 200).toBeLessThan(600);
  });

  it("keeps the top-left visible for narrow viewports and negative origins", () => {
    expect(contextMenuPosition(-20, -10, 396, 296, 400, 300)).toEqual({ left: 4, top: 4 });
  });
});
