import { uiText } from "../../lib/i18n";
import { STYLE_PRESETS as definitions } from "../../../../shared/visual-design/presets";
import { createVisualSpec, visualSpecPrompt } from "../../../../shared/visual-design/spec";
import type { StyleAppearance } from "./style-appearance";
export * from "../../../../shared/visual-design/presets";
export const STYLE_PRESETS = definitions.map(preset => ({ ...preset,
  get label() { return uiText(preset.label); },
  get description() { return uiText(preset.description); },
  get summary() { return uiText(preset.summary); },
}));
export function presetDesignContext(value: string, appearance?: StyleAppearance): string {
  return visualSpecPrompt(createVisualSpec({ styleId: value, ...appearance }));
}
