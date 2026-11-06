import { roundedLensMap } from '../../../app/shared/visual-design/liquid-lens';
import { createGlassOpticsEngine } from '../../../resources/visual-design/liquid-optics-engine.mjs';

export interface TemplateTuning {
  transitionStart: number;
  outerFade: number;
  darkEdge: number;
  brightEdge: number;
  edgeWidth: number;
  edgeInset: number;
}
export const DEFAULT_TUNING: TemplateTuning = {
  transitionStart: 0.45, outerFade: 0.025,
  darkEdge: 0.16, brightEdge: 0.14,
  edgeWidth: 0.30, edgeInset: 0.40,
};
const engine = createGlassOpticsEngine();
function quintic(value: number) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Standalone experiment. Production template math remains the baseline. */
export function tunedLensMap(width: number, height: number, radius: number, tuning: TemplateTuning) {
  const field = roundedLensMap(width, height, radius);
  const sampling = field.width / width;
  const bezel = Math.min(10, width / 2, height / 2);
  const mapRadius = Math.min(radius, width / 2, height / 2) * sampling;
  const { lut } = engine.buildDisplacementLUT(512, {
    baseT: 0.8, surface: engine.surfaces.squircle, fresnelFade: true,
  });
  function feather(t: number) {
    const inside = 1 - quintic((t - tuning.transitionStart) / (1 - tuning.transitionStart));
    const outside = tuning.outerFade > 0 ? quintic(t / tuning.outerFade) : 1;
    return inside * outside;
  }
  for (let index = 0; index < lut.length; index++) lut[index] = lut[index]! * feather(index / (lut.length - 1));
  engine.renderDisplacementMap(field.data, {
    width: field.width, height: field.height, radius: mapRadius,
    bezel: bezel * sampling, lut,
  });
  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const offset = (y * field.width + x) * 4;
      const depth = -engine.sdfRoundedRect(x + 0.5, y + 0.5, field.width, field.height, mapRadius);
      field.reflection.fill(0, offset, offset + 4);
      if (depth <= -0.5 || depth >= bezel * sampling) continue;
      const t = Math.max(0, depth / (bezel * sampling));
      const normal = engine.sdfGradient(x + 0.5, y + 0.5, field.width, field.height, mapRadius);
      const angle = Math.atan(engine.derivative(engine.surfaces.squircle, t));
      const light = Math.max(0, -normal.x * 0.6 - normal.y * 0.8);
      const originalReflection = (engine.fresnelReflectance(angle) * (0.18 + 0.65 * light) +
        Math.pow(light, 10) * Math.pow(1 - t, 5) * 0.12) * feather(t);
      const reflectionAlpha = Math.min(0.8, originalReflection) * Math.min(1, depth + 0.5);
      const contourPosition = (depth / sampling - tuning.edgeInset) / Math.max(0.15, tuning.edgeWidth);
      const contour = Math.exp(-contourPosition * contourPosition) * Math.max(0, Math.min(1, depth + 0.5));
      const darkAlpha = contour * Math.pow(Math.abs(normal.x), 4) * tuning.darkEdge;
      const lightAlpha = contour * Math.pow(Math.abs(normal.y), 4) * tuning.brightEdge;
      // Composite dark then light over the original transparent reflection map.
      const afterDarkAlpha = darkAlpha + reflectionAlpha * (1 - darkAlpha);
      const premultipliedWhite = reflectionAlpha * (1 - darkAlpha);
      const alpha = lightAlpha + afterDarkAlpha * (1 - lightAlpha);
      const white = alpha > 0 ? (lightAlpha + premultipliedWhite * (1 - lightAlpha)) / alpha : 0;
      field.reflection.set([white * 255, white * 255, white * 255, alpha * 255], offset);
    }
  }
  return field;
}
