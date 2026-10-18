export const STYLE_PALETTES = ["default", "mono", "coral", "green", "violet"] as const;
export const STYLE_EFFECTS = ["subtle", "standard"] as const;
export type StylePalette = typeof STYLE_PALETTES[number];
export type StyleEffect = typeof STYLE_EFFECTS[number];
export interface StyleAppearance { palette: StylePalette; effect: StyleEffect }
export const DEFAULT_APPEARANCE: StyleAppearance = { palette: "default", effect: "standard" };
