import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIQUID_MATERIAL_CORE } from './liquid-material-source';
import { LIQUID_PRESETS, liquidMaterialContract } from './liquid-contract';
import { showcaseRuntimeSource } from './showcase-runtime';

describe('shared droplet material', () => {
  it('keeps the accepted App and template optical parameters with separate blur', () => {
    expect(LIQUID_PRESETS.app.parameters.blur).toBe(2.5);
    expect(LIQUID_PRESETS.web.parameters.blur).toBe(0.2);
    const { blur: appBlur, ...app } = LIQUID_PRESETS.app.parameters;
    const { blur: webBlur, ...web } = LIQUID_PRESETS.web.parameters;
    expect(appBlur).not.toBe(webBlur);
    expect(app).toEqual(web);
    expect(web.ior).toBe(1.5);
    expect(web.sideWidth).toBe(1.3);
    expect(web.rimStrength).toBe(0.23);
    expect(web.darkEdge).toBe(0.26);
    expect(web.brightEdge).toBe(0.24);
  });
  it('generates GLSL from the same AGSL kernel without changing the equations', () => {
    const agsl = fs.readFileSync('resources/visual-design/liquid-material.agsl','utf8');
    const converted = agsl.replace('uniform shader backdrop;', '')
      .replace(/\bhalf4\b|\bfloat4\b/g,'vec4').replace(/\bhalf3\b|\bfloat3\b/g,'vec3')
      .replace(/\bfloat2\b/g,'vec2').replace(/\bhalf\b/g,'float')
      .replaceAll('backdrop.eval(', 'sampleCapture(').replace('vec4 main(vec2 sourcePoint)', 'vec4 shadeGlass(vec2 sourcePoint)');
    expect(LIQUID_MATERIAL_CORE).toBe(converted);
    expect(converted).toContain('backgroundColorAt');
    expect(converted).toContain('u_rimDispersion');
    expect(converted).toContain('u_brightEdge');
  });
  it('exports the WebGL entry and declares the distinct iOS native material', () => {
    const runtime = showcaseRuntimeSource();
    expect(runtime).toContain('EmLiquidWebGL.mountLiquidWebGL');
    expect(runtime).toContain('#version 300 es');
    expect(runtime).not.toContain('createGlassOpticsEngine');
    expect(liquidMaterialContract().platforms.ios.renderer).toBe('expo-glass-effect GlassView');
    expect(liquidMaterialContract().platforms.ios.minimumSystemVersion).toBe(26);
    expect(liquidMaterialContract().platforms.ios.sharedShaderParity).toBe(false);
  });
});
