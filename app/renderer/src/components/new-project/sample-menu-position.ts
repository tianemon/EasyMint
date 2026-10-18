export interface SampleRect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface SampleMenuPosition { left: number; top: number; width: number; maxHeight: number; side: "top" | "bottom" }

/** All rects are in viewport pixels; returned coordinates are unscaled artboard pixels. */
export function placeSampleMenu(anchor: SampleRect, frame: SampleRect, visible: SampleRect, size: { width: number; height: number }, desiredHeight: number): SampleMenuPosition | null {
  const sx = frame.width / size.width;
  const sy = frame.height / size.height;
  if (!(sx > 0 && sy > 0) || anchor.bottom <= visible.top || anchor.top >= visible.bottom) return null;
  const minLeft = Math.max(8, (visible.left - frame.left) / sx + 8);
  const maxRight = Math.min(size.width - 8, (visible.right - frame.left) / sx - 8);
  const minTop = Math.max(8, (visible.top - frame.top) / sy + 8);
  const maxBottom = Math.min(size.height - 8, (visible.bottom - frame.top) / sy - 8);
  const width = Math.min(anchor.width / sx, maxRight - minLeft);
  const top = (anchor.top - frame.top) / sy;
  const bottom = (anchor.bottom - frame.top) / sy;
  const below = Math.max(0, maxBottom - bottom - 6);
  const above = Math.max(0, top - 6 - minTop);
  const side = below >= desiredHeight || below >= above ? "bottom" : "top";
  const maxHeight = Math.min(desiredHeight, side === "bottom" ? below : above);
  if (width <= 0 || maxHeight <= 0) return null;
  return {
    left: Math.max(minLeft, Math.min((anchor.left - frame.left) / sx, maxRight - width)),
    top: side === "bottom" ? bottom + 6 : top - 6 - maxHeight,
    width, maxHeight, side,
  };
}
