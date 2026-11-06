import { describe, expect, it } from 'vitest';
import { spectrumUniforms, extendMaterial } from './spectrum.mjs';
import { LIQUID_MATERIAL_CORE } from '../../../app/shared/visual-design/liquid-material-source';

describe('spectral demo material', () => {
  for (const count of [8, 12]) {
    it(`${count} bands preserve a constant background without a color cast`, () => {
      const data = spectrumUniforms(count);
      const source = [0.12, 0.4, 0.83];
      const result = [0, 0, 0];
      for (let sample = 0; sample < count; sample++) {
        for (let channel = 0; channel < 3; channel++) {
          expect(data[sample*4+channel]).toBeGreaterThanOrEqual(0);
          result[channel] += source[channel] * data[sample*4+channel];
        }
      }
      result.forEach((value, channel) => expect(value).toBeCloseTo(source[channel], 6));
      expect([...data.slice(count*4)].every(value => value === 0)).toBe(true);
    });
    it(`${count} bands order refractive indices from blue to red`, () => {
      const data = spectrumUniforms(count);
      expect(data[3]).toBeCloseTo(1, 6);
      expect(data[(count-1)*4+3]).toBeLessThan(0);
      for (let index = 1; index < count; index++) expect(data[index*4+3]).toBeLessThan(data[(index-1)*4+3]);
    });
  }
  it('retains the accepted edge profile, lighting and two-interface exit ray', () => {
    const extended = extendMaterial(LIQUID_MATERIAL_CORE);
    const edgeStart = '      float sectionWidth = bevel * 0.36;';
    expect(extended.slice(extended.indexOf(edgeStart))).toBe(LIQUID_MATERIAL_CORE.slice(LIQUID_MATERIAL_CORE.indexOf(edgeStart)));
    expect(extended).toContain('vec3 outside = refract(inside, vec3(0, 0, 1), ior);');
  });
  it('rejects unsupported band counts and an incompatible shared kernel', () => {
    expect(() => spectrumUniforms(9)).toThrow();
    expect(() => extendMaterial('changed kernel')).toThrow();
  });
});
