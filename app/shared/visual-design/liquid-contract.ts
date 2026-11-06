import appPreset from '../../../resources/visual-design/liquid-app-preset.json';
import templatePreset from '../../../resources/visual-design/liquid-template-preset.json';
export const LIQUID_PRESETS = { app: appPreset, web: templatePreset };
export function liquidMaterialContract() {
  return {
    schemaVersion: 1, material: 'shared-droplet-v1', primaryWebBackend: 'webgl2',
    preset: 'liquid-template-preset.json', appPreset: 'liquid-app-preset.json',
    kernel: 'liquid-material.agsl', webSource: 'liquid-webgl.ts',
    androidSource: 'liquid-android-reference.kt', guide: 'LIQUID-USAGE.md',
    platforms: {
      web: { status: 'implemented', capture: 'controlled DOM texture cache', renderer: 'GLSL WebGL 2' },
      android: { status: 'implemented-reference', minimumOpticalApi: 33, capture: 'RenderNode', renderer: 'AGSL RuntimeShader' },
      ios: { status: 'native-system-integration', minimumSystemVersion: 26, renderer: 'expo-glass-effect GlassView',
        style: 'clear', fallback: 'BlurView', reducedTransparency: 'opaque', sharedShaderParity: false },
    },
    acceptance: ['real-background-sampling', 'continuous-rim-refraction', 'fine-lateral-dark-contours',
      'fine-horizontal-light-contours', 'light-dark-themes', 'foreground-input-preserved', 'target-device-validation'],
  };
}
