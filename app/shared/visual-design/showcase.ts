import { renderLiquidShowcase } from './liquid-showcase';
import { renderGlassShowcase } from './glass-showcase';
import { renderCuratedScene } from './curated-showcases';
import { SCENE_DEFINITIONS } from './scene-contract';
import type { VisualSpec } from './spec';

export const SHOWCASE_SCENES = Object.fromEntries(Object.entries(SCENE_DEFINITIONS).map(([id,value])=>[id,value.scene])) as Record<keyof typeof SCENE_DEFINITIONS,string>;
export type ShowcaseScene = typeof SHOWCASE_SCENES[keyof typeof SHOWCASE_SCENES];
/** One product scene per style. The old motion argument is a compatibility alias, never another destination. */
export function renderShowcase(spec:VisualSpec,_legacyMotion=false):string {
  if(spec.selection.styleId==='liquid-glass')return renderLiquidShowcase(spec);
  if(spec.selection.styleId==='glass')return renderGlassShowcase(spec);
  return `<div class="sc-page sc-curated" data-sc-scene="${SHOWCASE_SCENES[spec.selection.styleId]}" data-style="${spec.selection.styleId}" data-effect="${spec.selection.effect}" data-sc-mode="page" id="sc-top">${renderCuratedScene(spec)}<div class="sc-notice" role="status" aria-live="polite" hidden></div></div>`;
}
