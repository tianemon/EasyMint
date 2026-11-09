import { LIQUID_MATERIAL_CORE } from '../../../../app/shared/visual-design/liquid-material-source';
import { extendMaterial } from './spectrum.mjs';
export { spectrumUniforms } from './spectrum.mjs';

export const header = `#version 300 es
precision highp float;
uniform sampler2D uBackdrop; uniform sampler2D uScene;
uniform vec2 uViewport; uniform vec4 uRects[2]; uniform float uRadii[2];
uniform float u_bevelRatio; uniform float u_width; uniform float u_tint; uniform float u_referenceScale;
in vec2 vUv; out vec4 fragColor;
vec2 size; float radius; float bevel; float refractionWidth; float pixelScale; float padding;
vec2 captureOrigin;
vec4 sampleCapture(vec2 uv) {
  vec2 globalPoint = captureOrigin + uv - padding;
  vec2 textureUV = clamp(globalPoint / (uViewport * u_referenceScale), vec2(0.001), vec2(0.999));
  return texture(uBackdrop, vec2(textureUV.x, 1.0-textureUV.y));
}
`;
export const footer = `
void main() {
  vec2 point = vec2(vUv.x,1.0-vUv.y) * uViewport * u_referenceScale;
  vec4 result = texture(uScene,vUv);
  for(int i=0;i<2;i++) {
    captureOrigin = uRects[i].xy * u_referenceScale;
    size = uRects[i].zw * u_referenceScale;
    radius = min(uRadii[i] * u_referenceScale,min(size.x,size.y)*0.5);
    pixelScale = u_referenceScale; padding = 26.0 * u_referenceScale;
    bevel = size.y * u_bevelRatio; refractionWidth = bevel * u_width;
    vec2 localPoint = point - captureOrigin;
    float distance = surfaceDistance(localPoint);
    float aa = max(fwidth(distance),0.75);
    if(distance < aa) {
      vec4 glass = shadeGlass(localPoint+padding);
      glass.rgb *= 1.0-u_tint;
      result = mix(result,glass,1.0-smoothstep(-aa,aa,distance));
    }
  }
  fragColor = result;
}`;
export const materialFragment = header + extendMaterial(LIQUID_MATERIAL_CORE) + footer;
