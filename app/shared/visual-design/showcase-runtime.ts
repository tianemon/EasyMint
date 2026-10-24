import { mountSceneJourneys } from './scene-journeys';
import { mountShowcase } from './showcase-interactions';
import { mountCyberpunkMotion } from './cyberpunk-motion';
import { CYBERPUNK_LAND } from './cyberpunk-land';
import { mountLiquidShowcase } from './liquid-interactions';
import { roundedLensMap } from './liquid-lens';
import { renderLiquidIcon } from './liquid-icons';
import { createGlassOpticsEngine, LIQUID_OPTICS_LICENSE } from '../../../resources/visual-design/liquid-optics-engine.mjs';

export function mountShowcasePreview(root:HTMLElement,english:boolean):()=>void {
  if(root.hasAttribute('data-ios-root'))return mountLiquidShowcase(root,english,roundedLensMap,renderLiquidIcon);
  const journeys=mountSceneJourneys(root,english),dispose=mountShowcase(root,english),motion=root.dataset.style==='tech'?mountCyberpunkMotion(root,english,CYBERPUNK_LAND):undefined;
  return ()=>{motion?.();journeys();dispose();};
}
/** Export the same implementations, with explicit dependencies and no bundler-scope references. */
export function showcaseRuntimeSource():string {
  return `/* EasyMint scene runtime */\n/* geographic data: Natural Earth (public domain), world-atlas (ISC). Copyright 2013-2019 Michael Bostock. Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE. */\n/* ${LIQUID_OPTICS_LICENSE} */\n(() => { const scene = document.querySelector('.sc-page'); if (!scene) return; const english = document.documentElement.lang === 'en'; if (scene.hasAttribute('data-ios-root')) { const engine = (${createGlassOpticsEngine.toString()})(); const makeLens = (width,height,radius,options) => (${roundedLensMap.toString()})(width,height,radius,options,engine); (${mountLiquidShowcase.toString()})(scene, english, makeLens, (${renderLiquidIcon.toString()})); } else { (${mountSceneJourneys.toString()})(scene,english); (${mountShowcase.toString()})(scene, english); if(scene.dataset.style==='tech') (${mountCyberpunkMotion.toString()})(scene,english,${JSON.stringify(CYBERPUNK_LAND)}); } })();`;
}
