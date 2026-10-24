// glass-optics.mjs — shared physical optics for Liquid Glass.
//
// Models the glass as a slab with a convex squircle bezel resting on the
// background plane, and traces a vertical viewing ray through it:
//
//   1. Air → glass at the curved top surface (Snell's law)
//   2. Straight propagation through the glass interior
//   3. Glass → air at the flat bottom (no lateral shift added when the
//      background sits directly behind the glass)
//
// Surface profile (height vs normalized distance x from the outer edge):
//
//   f(x) = (1 - (1-x)^4)^(1/4)          convex squircle (superellipse n=4)
//
// Ray-trace displacement, in units of the bezel width B:
//
//   θs(x)  = atan f'(x)                  surface tilt = incidence angle
//   θr(x)  = asin( sin θs / n )          refraction angle (Snell)
//   t(x)   = T0 + B·f(x)                 glass thickness below entry point
//   d(x)   = t(x) · tan(θs − θr)         lateral shift at the background
//
// d(x) is monotonically decreasing from the rim inward (peak ≈ 0.76·B at
// x≈0.01 for n=1.52, T0=0.35·B), matching the strong edge lensing of the
// real material. The previous heuristic slope/(1+slope²) = ½·sin 2θ peaked
// at a 45° slope (x≈0.16) and fell to zero AT the rim — backwards.
//
// Dispersion (chromatic aberration) uses the thin-prism ratio
// (n_λ − 1)/(n_d − 1) with BK7 crown-glass Fraunhofer indices, optionally
// exaggerated by a strength factor for visibility at UI scale.
//
// Fresnel (unpolarized, air→glass) gives the transmittance/reflectance
// profile across the bezel — used to fade displacement where the surface
// stops transmitting, and to shape the bright rim ring.

// ── Material ───────────────────────────────────────────────────────────────
export const N_D = 1.5168 // BK7 crown glass, d line (587.6 nm)
export const N_C = 1.5143 // 656.3 nm (red)
export const N_F = 1.5224 // 486.1 nm (blue)

// Per-channel displacement scale ratios (thin-prism deviation ∝ n−1),
// exaggerated by `strength` (1 = physically exact, ~6 reads well in UI).
export function dispersionScales(strength = 1) {
  const r = (N_C - 1) / (N_D - 1) // 0.99516
  const b = (N_F - 1) / (N_D - 1) // 1.01084
  return {
    red: 1 + (r - 1) * strength,
    green: 1,
    blue: 1 + (b - 1) * strength,
  }
}

// ── Surface profile ────────────────────────────────────────────────────────
export const surfaces = {
  squircle: (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25),
  circle: (x) => Math.sqrt(1 - Math.pow(1 - x, 2)),
}

export function derivative(f, x, h = 1e-4) {
  const a = Math.max(0, x - h)
  const b = Math.min(1, x + h)
  return (f(b) - f(a)) / (b - a)
}

// ── Fresnel (unpolarized power reflectance, air → glass) ───────────────────
export function fresnelReflectance(thetaI, n = N_D) {
  const ci = Math.cos(thetaI)
  const st = Math.sin(thetaI) / n
  if (st >= 1) return 1 // grazing / TIR limit
  const ct = Math.sqrt(1 - st * st)
  const rs = (ci - n * ct) / (ci + n * ct)
  const rp = (n * ci - ct) / (n * ci + ct)
  return 0.5 * (rs * rs + rp * rp)
}

// ── Physical displacement profile across the bezel ─────────────────────────
// x ∈ [0,1]: 0 at the outer edge, 1 at the flat interior.
// Returns displacement in units of the bezel width B.
//   n         refractive index
//   baseT     flat base thickness under the bezel, in units of B
//   fresnelFade  weight displacement by Fresnel transmittance so the
//                non-transmitting grazing rim doesn't encode garbage
export function displacementProfile(x, {
  n = N_D,
  baseT = 0.35,
  surface = surfaces.squircle,
  fresnelFade = true,
} = {}) {
  const slope = derivative(surface, x)
  const thetaS = Math.atan(slope)
  const thetaR = Math.asin(Math.sin(thetaS) / n)
  const t = baseT + surface(x)
  let d = t * Math.tan(thetaS - thetaR)
  if (fresnelFade) d *= 1 - fresnelReflectance(thetaS, n)
  return d
}

// ── LUT builder ────────────────────────────────────────────────────────────
// Normalized to peak = 1; pair with the returned peak (in units of B) to
// convert an feDisplacementMap scale to physical pixels.
export function buildDisplacementLUT(samples = 255, opts = {}) {
  const lut = new Float32Array(samples + 1)
  let peak = 0
  for (let i = 0; i <= samples; i++) {
    const d = displacementProfile(i / samples, opts)
    lut[i] = d
    if (d > peak) peak = d
  }
  for (let i = 0; i <= samples; i++) lut[i] /= peak
  return { lut, peak }
}

export function sampleLUT(lut, t) {
  const s = lut.length - 1
  const ft = Math.min(1, Math.max(0, t)) * s
  const i = Math.floor(ft)
  const j = Math.min(s, i + 1)
  const frac = ft - i
  return lut[i] * (1 - frac) + lut[j] * frac // linear interp, no banding
}

// ── Rounded-rect SDF (exact) ───────────────────────────────────────────────
export function sdfRoundedRect(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - w / 2 + r
  const qy = Math.abs(py - h / 2) - h / 2 + r
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - r
}

export function sdfGradient(px, py, w, h, r, e = 0.75) {
  const dx = sdfRoundedRect(px + e, py, w, h, r) - sdfRoundedRect(px - e, py, w, h, r)
  const dy = sdfRoundedRect(px, py + e, w, h, r) - sdfRoundedRect(px, py - e, w, h, r)
  const mag = Math.hypot(dx, dy) || 1
  return { x: dx / mag, y: dy / mag }
}

// ── Map renderer ───────────────────────────────────────────────────────────
// Fills an RGBA buffer (Uint8ClampedArray or Buffer, length w*h*4) with the
// displacement vector field for a w×h rounded rect. R = +x, G = +y, 128 = 0.
// Works in Node (Buffer + sharp) and the browser (ImageData.data).
export function renderDisplacementMap(data, {
  width,
  height,
  radius,
  bezel,
  lut,
  channelDepth = 127,
} = {}) {
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const idx = (py * width + px) * 4
      let r = 128
      let g = 128
      const dist = -sdfRoundedRect(px + 0.5, py + 0.5, width, height, radius)
      if (dist > 0 && dist < bezel) {
        const mag = sampleLUT(lut, dist / bezel)
        // SDF gradient points outward; convex glass shifts the background
        // sample point inward (toward the center).
        const nrm = sdfGradient(px + 0.5, py + 0.5, width, height, radius)
        r = Math.round(128 - nrm.x * mag * channelDepth)
        g = Math.round(128 - nrm.y * mag * channelDepth)
        r = Math.max(0, Math.min(255, r))
        g = Math.max(0, Math.min(255, g))
      }
      data[idx] = r
      data[idx + 1] = g
      data[idx + 2] = 128
      data[idx + 3] = 255
    }
  }
  return data
}

// ── Fresnel rim profile (for the shine layer design) ───────────────────────
// Reflectance vs normalized bezel position — how bright the rim ring should
// be as a function of distance from the edge.
export function rimReflectanceProfile(samples = 32, { n = N_D, surface = surfaces.squircle } = {}) {
  const out = new Float32Array(samples + 1)
  for (let i = 0; i <= samples; i++) {
    const slope = derivative(surface, i / samples)
    out[i] = fresnelReflectance(Math.atan(slope), n)
  }
  return out
}
