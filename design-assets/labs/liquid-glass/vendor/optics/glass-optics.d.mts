// Local integration types; the adjacent upstream JavaScript is unmodified.
export const surfaces: { squircle: (x: number) => number; circle: (x: number) => number };
export function derivative(f: (x: number) => number, x: number, h?: number): number;
export function fresnelReflectance(thetaI: number, n?: number): number;
export function buildDisplacementLUT(samples?: number, options?: { n?: number; baseT?: number; surface?: (x: number) => number; fresnelFade?: boolean }): { lut: Float32Array; peak: number };
export function renderDisplacementMap(data: Uint8ClampedArray, options: { width: number; height: number; radius: number; bezel: number; lut: Float32Array; channelDepth?: number }): Uint8ClampedArray;
export function sdfRoundedRect(px: number, py: number, width: number, height: number, radius: number): number;
export function sdfGradient(px: number, py: number, width: number, height: number, radius: number, e?: number): { x: number; y: number };
