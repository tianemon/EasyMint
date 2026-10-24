export interface GlassOpticsEngine {
  surfaces: { squircle: (x: number) => number; circle: (x: number) => number };
  derivative(f: (x: number) => number, x: number, h?: number): number;
  fresnelReflectance(thetaI: number, n?: number): number;
  buildDisplacementLUT(samples?: number, options?: { n?: number; baseT?: number; surface?: (x: number) => number; fresnelFade?: boolean }): { lut: Float32Array; peak: number };
  renderDisplacementMap(data: Uint8ClampedArray, options: { width: number; height: number; radius: number; bezel: number; lut: Float32Array; channelDepth?: number }): Uint8ClampedArray;
  sdfRoundedRect(px: number, py: number, width: number, height: number, radius: number): number;
  sdfGradient(px: number, py: number, width: number, height: number, radius: number, e?: number): { x: number; y: number };
}
export function createGlassOpticsEngine(): GlassOpticsEngine;
export const LIQUID_OPTICS_LICENSE: string;
