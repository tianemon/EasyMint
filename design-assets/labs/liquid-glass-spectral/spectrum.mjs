/** CIE XYZ analytic fit; positive RGB basis is normalized for a neutral constant background.
 * This is an RGB-texture spectral approximation, not a spectral radiance reconstruction.
 */
export function spectrumUniforms(count) {
  if (count !== 8 && count !== 12) throw new Error('光谱采样仅支持 8 或 12 波段');
  const gaussian = (wave, mean, left, right) => Math.exp(-0.5 * ((wave - mean) / (wave < mean ? left : right)) ** 2);
  const weights = [];
  const sums = [0, 0, 0];
  const reference = 550;
  const firstWave = 420 + 260 * 0.5 / count;
  const lastWave = 420 + 260 * (count - 0.5) / count;
  const radius = Math.max((reference / firstWave) ** 2 - 1, 1 - (reference / lastWave) ** 2);
  for (let index = 0; index < count; index++) {
    const wave = 420 + 260 * (index + 0.5) / count;
    const x = 1.056 * gaussian(wave, 599.8, 37.9, 31) + 0.362 * gaussian(wave, 442, 16, 26.7) - 0.065 * gaussian(wave, 501.1, 20.4, 26.2);
    const y = 0.821 * gaussian(wave, 568.8, 46.9, 40.5) + 0.286 * gaussian(wave, 530.9, 16.3, 31.1);
    const z = 1.217 * gaussian(wave, 437, 11.8, 36) + 0.681 * gaussian(wave, 459, 26, 13.8);
    const rgb = [Math.max(0, 3.2406*x - 1.5372*y - 0.4986*z), Math.max(0, -0.9689*x + 1.8758*y + 0.0415*z), Math.max(0, 0.0557*x - 0.204*y + 1.057*z)];
    rgb.forEach((value, channel) => { sums[channel] += value; });
    weights.push([...rgb, ((reference / wave) ** 2 - 1) / radius]);
  }
  const data = new Float32Array(12 * 4);
  weights.forEach((sample, index) => {
    sample.slice(0,3).forEach((value, channel) => { data[index*4+channel] = value / sums[channel]; });
    data[index*4+3] = sample[3];
  });
  return data;
}

function replaceOnce(source, anchor, value) {
  if (source.split(anchor).length !== 2) throw new Error('共享材质已变化，请核对实验扩展：' + anchor.slice(0,60));
  return source.replace(anchor, value);
}

export function extendMaterial(core) {
  let source = core.replace(/uniform (?:vec2|float) (?:size|radius|bevel|refractionWidth|pixelScale|padding);/g, '');
  source = replaceOnce(source, 'vec2 back = p + inside.xy * height /', 'vec2 back = p + inside.xy * height * u_thicknessGain /');
  source = replaceOnce(source, 'vec3 normal = normalize(vec3(-gradient, 1.0));', 'vec3 normal = normalize(vec3(-gradient * u_curveGain, 1.0));');
  const start = source.indexOf('      float dispersion = edgeSupport');
  const end = source.indexOf('\n\n      float sectionWidth', start);
  if (start < 0 || end < 0) throw new Error('找不到共享色散区间');
  source = source.slice(0,start) + `      float dispersion = (edgeSupport * u_dispersion + rimDispersion * u_rimDispersion) * u_spectralGain;
      if (u_spectralBands < 4.0) {
        color.r = mix(color.r, sampleBackground(trace(p, normal, height, u_ior - dispersion)).r, edgeBlend);
        color.b = mix(color.b, sampleBackground(trace(p, normal, height, u_ior + dispersion)).b, edgeBlend);
      } else if (edgeBlend > 0.0001 && dispersion > 0.000001) {
        vec3 sum = vec3(0.0);
        for (int band = 0; band < 12; band++) {
          if (float(band) >= u_spectralBands) break;
          float waveIor = max(1.001, u_ior + dispersion * u_spectrum[band].a);
          vec2 samplePoint = mix(faceUV, trace(p, normal, height, waveIor), edgeBlend);
          sum += spectralToLinear(sampleBackground(samplePoint).rgb) * u_spectrum[band].rgb;
        }
        color.rgb = spectralToSrgb(sum);
      }
      float faceLuma = luminance(color.rgb);
      color.rgb = max(mix(vec3(faceLuma), color.rgb, u_saturation), vec3(0.0));` + source.slice(end);
  return `uniform float u_spectralBands;
uniform float u_spectralGain;
uniform float u_thicknessGain;
uniform float u_curveGain;
uniform float u_saturation;
uniform vec4 u_spectrum[12];
vec3 spectralToLinear(vec3 value) {
  value = max(value, vec3(0.0));
  return mix(value / 12.92, pow((value + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), value));
}
vec3 spectralToSrgb(vec3 value) {
  value = max(value, vec3(0.0));
  return mix(value * 12.92, 1.055 * pow(value, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), value));
}
` + source;
}
