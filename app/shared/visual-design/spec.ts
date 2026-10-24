import brands from "./brands.json";
import { STYLE_PRESETS, resolveStylePreset, sampleStyle, type StylePreset } from "./presets";
import { DEFAULT_APPEARANCE, STYLE_EFFECTS, STYLE_PALETTES, type StyleAppearance } from "./appearance";
export const VISUAL_SPEC_VERSION = 1;
export const STYLE_PACK_VERSION = 1;
export const VISUAL_LAYOUTS = ["dashboard", "landing", "form", "detail"] as const;
export type VisualLayout = typeof VISUAL_LAYOUTS[number];
export const BRAND_REFERENCES = brands;
export interface VisualSelection {
    projectName?: string;
    projectDescription?: string;
    locale?: string;
    styleId?: string;
    palette?: string;
    effect?: string;
    brandId?: string;
    layout?: string;
    targets?: string[];
    brief?: string;
}
export interface VisualSpec {
    schemaVersion: 1;
    packVersion: 1;
    selection: {
        projectName: string;
        projectDescription: string;
        locale: "zh-CN" | "en";
        styleId: StylePreset["id"];
        palette: StyleAppearance["palette"];
        effect: StyleAppearance["effect"];
        brandId: string;
        layout: VisualLayout;
        targets: string[];
        brief: string;
    };
    provenance: {
        kind: "builtin" | "brand-inspired";
        reference?: string;
        quality: "curated" | "derived" | "builtin";
        traits?: {
            typography: unknown;
            rounded: unknown;
            ink?: string;
            background?: string;
        };
    };
    primitive: {
        fontSize: Record<string, number>;
        spacing: Record<string, number>;
        radius: Record<string, string>;
        shadow: Record<string, string>;
    };
    semantic: Pick<StylePreset, "background" | "surface" | "ink" | "muted" | "accent" | "border" | "colors"> & {
        controls: StylePreset["recipes"];
    };
    components: StylePreset["recipes"];
    states: StylePreset["states"];
    material: Pick<StylePreset, "artwork" | "font" | "density" | "sidebar" | "texture" | "layout" | "rules" | "radius" | "tone"> & {
        blur: number;
        saturation: number;
    };
}
const hex = (s: string) => s.length === 4 ? '#' + [...s.slice(1)].map(c => c + c).join('') : s.slice(0, 7);
function mix(s: string, white: number): string { const n = parseInt(hex(s).slice(1), 16); return '#' + [16, 8, 0].map(shift => Math.round(((n >> shift) & 255) * (1 - white) + 255 * white).toString(16).padStart(2, '0')).join(''); }
function luminance(s:string):number {
    const n=parseInt(hex(s).slice(1),16);
    return [16,8,0].reduce((sum,shift,i)=>{const v=((n>>shift)&255)/255;return sum+(v<=.04045?v/12.92:((v+.055)/1.055)**2.4)*[.2126,.7152,.0722][i]!},0);
}
function contrast(a:string,b:string):number {
    const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);
    return (values[0]!+.05)/(values[1]!+.05);
}
function foreground(s:string):string {
    return ['#ffffff','#171923','#000000'].find(color=>contrast(color,s)>=4.5)!;
}
function readableAccent(accent:string,background:string):string {
    let candidate = accent;
    for (let step = 0; step < 10 && contrast(candidate, background) < 4.5; step++) {
        const n = parseInt(hex(candidate).slice(1), 16);
        candidate = '#' + [16, 8, 0].map(shift => Math.round(((n >> shift) & 255) * .8).toString(16).padStart(2, '0')).join('');
    }
    return candidate;
}
export function createVisualSpec(input: VisualSelection = {}): VisualSpec {
    const base = STYLE_PRESETS.find(p => p.id === input.styleId) ?? STYLE_PRESETS[0];
    const appearance: StyleAppearance = { palette: STYLE_PALETTES.includes(input.palette as any) ? input.palette as any : DEFAULT_APPEARANCE.palette, effect: STYLE_EFFECTS.includes(input.effect as any) ? input.effect as any : base.id === 'liquid-glass' ? 'subtle' : DEFAULT_APPEARANCE.effect };
    const preset = resolveStylePreset(base, appearance);
    const brand = brands.find(b => b.id === input.brandId);
    if (input.brandId && !brand)
        throw new Error('Unknown visual reference');
    if (brand?.quality === 'reference')
        throw new Error('This brand is a text reference, not a previewable theme');
    if (brand?.accent) {
        const originalAccent = preset.accent;
        const accent = hex(brand.accent);
        for (const recipe of Object.values(preset.recipes))
            for (const key of Object.keys(recipe) as (keyof typeof recipe)[])
                recipe[key] = recipe[key].replaceAll(originalAccent, accent);
        for (const key of Object.keys(preset.states) as (keyof typeof preset.states)[])
            preset.states[key] = preset.states[key].replaceAll(originalAccent, accent);
        preset.accent = accent;
        preset.colors.accent = accent;
        preset.colors.accentSoft = mix(accent, .85);
        preset.colors.onAccentSoft = readableAccent(accent, preset.colors.accentSoft);
        preset.artwork.color = accent;
        preset.artwork.soft = mix(accent, .8);
        if (preset.id === 'neumorphism')
            preset.recipes.primary.color = readableAccent(accent, '#e9edf3');
        else {
            preset.recipes.primary.background = preset.id === 'skeuomorphism' ? `linear-gradient(${mix(accent, .15)},${accent})` : accent;
            preset.recipes.primary.color = foreground(accent);
        }
        const secondarySurface=/^#[0-9a-f]{6}$/i.test(preset.recipes.secondary.background)?preset.recipes.secondary.background:/^#[0-9a-f]{6}$/i.test(preset.background)?preset.background:'#ffffff';
        preset.recipes.secondary.color = preset.id === 'glass' || preset.tone === 'dark' ? mix(accent, .7) : readableAccent(accent, secondarySurface);
    }
    if (brand && ['minimalism', 'flat', 'material'].includes(preset.id)) {
        const oldInk = preset.ink;
        // A reference may describe a dark brand; never combine its white ink with light component surfaces.
        if (brand.ink && contrast(brand.ink,'#ffffff')>=4.5 && Object.values(preset.recipes).filter(recipe=>recipe.color===oldInk&&/^#[0-9a-f]{6}$/i.test(recipe.background)).every(recipe=>contrast(brand.ink!,recipe.background)>=4.5)) {
            preset.ink = brand.ink;
            for (const recipe of Object.values(preset.recipes))
                if (recipe.color === oldInk)
                    recipe.color = brand.ink;
        }
        if (brand.background && ['#171923','#000000'].includes(foreground(brand.background)))
            preset.background = brand.background;
        if (preset.id !== 'flat') {
            const radius = brand.rounded as Record<string, string>;
            if (radius.md)
                for (const key of ['primary', 'secondary', 'input'] as const)
                    preset.recipes[key].radius = radius.md;
            if (radius.lg)
                preset.recipes.card.radius = radius.lg;
        }
    }
    const bodyScale = brand?.typography.bodySize ? Math.max(.95, Math.min(1.2, brand.typography.bodySize / 14)) : 1;
    const displayScale = brand?.typography.displaySize ? Math.max(.95, Math.min(1.2, brand.typography.displaySize / 40)) : 1;
    const id = base.id;
    const controls = Object.fromEntries(Object.entries(preset.recipes).map(([key, recipe]) => [key, { ...recipe, radius: `{primitive.radius.${key}}`, shadow: `{primitive.shadow.${key}}` }])) as unknown as StylePreset["recipes"];
    const components = Object.fromEntries(Object.entries(preset.recipes).map(([key, recipe]) => [key, Object.fromEntries(Object.keys(recipe).map(property => [property, `{semantic.controls.${key}.${property}}`]))])) as unknown as StylePreset["recipes"];
    return { schemaVersion: 1, packVersion: 1, selection: { projectName: (input.projectName ?? '').slice(0, 200), projectDescription: (input.projectDescription ?? '').slice(0, 2000), locale: input.locale === 'en' ? 'en' : 'zh-CN', styleId: id, ...appearance, brandId: brand?.id ?? '', layout: VISUAL_LAYOUTS.includes(input.layout as any) ? input.layout as VisualLayout : 'dashboard', targets: [...(input.targets ?? ['web'])], brief: (input.brief ?? (!input.styleId || input.styleId === id ? '' : input.styleId)).slice(0, 1000) },
        provenance: brand ? { kind: 'brand-inspired', reference: brand.source, quality: brand.curated ? 'curated' : 'derived', traits: { typography: brand.typography, rounded: brand.rounded, ink: brand.ink, background: brand.background } } : { kind: 'builtin', quality: 'builtin' },
        primitive: { fontSize: { caption: 11, small: 12, body: Math.round(13 * bodyScale), label: Math.round(14 * bodyScale), title: Math.round(24 * displayScale), display: Math.round(40 * displayScale) }, spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, section: 32 }, radius: Object.fromEntries(Object.entries(preset.recipes).map(([k, v]) => [k, v.radius])), shadow: Object.fromEntries(Object.entries(preset.recipes).map(([k, v]) => [k, v.shadow])) },
        semantic: { background: preset.background, surface: preset.surface, ink: preset.ink, muted: preset.muted, accent: preset.accent, border: preset.border, colors: preset.colors, controls }, components, states: preset.states,
        material: { artwork: preset.artwork, font: preset.font, density: preset.density, sidebar: preset.sidebar, texture: preset.texture, layout: preset.layout, rules: preset.rules, radius: preset.radius, tone:preset.tone??(preset.id==='glass'?'dark':'light'), blur: preset.id === 'glass' ? (appearance.effect === 'subtle' ? 4 : 24) : preset.id==='liquid-glass'?(appearance.effect==='subtle'?0.25:3):0, saturation: preset.id==='liquid-glass'?1.35:1.12 } };
}
export function resolveVisualValue(spec: VisualSpec, value: string, seen = new Set<string>()): string {
    const reference = value.match(/^\{([\w.]+)\}$/);
    if (!reference)
        return value;
    const key = reference[1]!;
    if (seen.has(key))
        throw new Error('Circular visual token reference');
    seen.add(key);
    let target: any = spec;
    for (const part of key.split('.'))
        target = target?.[part];
    if (typeof target !== 'string')
        throw new Error(`Unknown visual token: ${key}`);
    return resolveVisualValue(spec, target, seen);
}
export function resolvedComponents(spec: VisualSpec): StylePreset["recipes"] {
    return Object.fromEntries(Object.entries(spec.components).map(([key, recipe]) => [key, Object.fromEntries(Object.entries(recipe).map(([property, value]) => [property, resolveVisualValue(spec, value)]))])) as unknown as StylePreset["recipes"];
}
export function presetFromVisualSpec(spec: VisualSpec): StylePreset {
    const base = STYLE_PRESETS.find(p => p.id === spec.selection.styleId)!;
    return { ...base, ...spec.semantic, ...spec.material, recipes: resolvedComponents(spec), scales: spec.primitive, states: spec.states, appearance: { palette: spec.selection.palette, effect: spec.selection.effect } };
}
export function visualVariables(spec: VisualSpec): Record<string, string> {
    return { ...sampleStyle(presetFromVisualSpec(spec)), "--visual-blur": `${spec.material.blur}px`, ...Object.fromEntries(Object.entries(spec.primitive.fontSize).map(([k, v]) => [`--visual-font-${k}`, `${v}px`])), ...Object.fromEntries(Object.entries(spec.primitive.spacing).map(([k, v]) => [`--visual-space-${k}`, `${v}px`])) };
}
export function parseVisualSpec(value: unknown): VisualSpec {
    const v = value as VisualSpec;
    if (!v || v.schemaVersion !== 1 || v.packVersion !== 1 || !STYLE_PRESETS.some(p => p.id === v.selection?.styleId) || !VISUAL_LAYOUTS.includes(v.selection.layout) || !STYLE_PALETTES.includes(v.selection.palette) || !STYLE_EFFECTS.includes(v.selection.effect) || !v.primitive || !v.semantic || !v.components || !v.material || !v.states)
        throw new Error('Unsupported visual specification');
    if (!['zh-CN', 'en'].includes(v.selection.locale) || !Array.isArray(v.selection.targets) || v.selection.targets.some(target => typeof target !== 'string') || typeof v.selection.brief !== 'string')
        throw new Error('Incomplete visual selection');
    for (const scale of [v.primitive.fontSize, v.primitive.spacing])
        if (!scale || Object.values(scale).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000))
            throw new Error('Invalid visual scale');
    if (!Number.isFinite(v.material.radius) || !Number.isFinite(v.material.blur) || v.material.blur < 0 || v.material.blur > 100 || !Number.isFinite(v.material.saturation))
        throw new Error('Invalid visual material');
    for (const name of ['card', 'primary', 'secondary', 'input', 'menu'] as const)
        for (const property of ['background', 'color', 'border', 'radius', 'shadow'] as const)
            if (typeof v.components[name]?.[property] !== 'string')
                throw new Error('Incomplete visual component');
    for (const group of [v.semantic, v.components, v.states, v.material, v.primitive]) {
        const check = (x: unknown): void => { if (typeof x === 'string' && (/[<>{};]/.test(resolveVisualValue(v, x)) || /url\s*\(/i.test(resolveVisualValue(v, x))))
            throw new Error('Unsafe visual value'); if (x && typeof x === 'object')
            Object.values(x).forEach(check); };
        // Rules are human-readable guidance, never CSS declarations.
        const copy = { ...group } as Record<string, unknown>;
        delete copy.rules;
        delete copy.layout;
        check(copy);
    }
    const variables = visualVariables(v);
    if (Object.values(variables).some(x => typeof x !== 'string'))
        throw new Error('Incomplete visual specification');
    return v;
}
export function visualSpecPrompt(spec: VisualSpec): string {
    const brief = spec.selection.brief.trim();
    const undescribed = brief === 'custom';
    const reference = brief
        ? undescribed
            ? `The user selected a custom style without a description. Read .easymint/design/showcase.html AND showcase-mobile.html only as a neutral scaffold. Do not present the included ${spec.selection.styleId} scene as the chosen direction; confirm the intended direction before inventing a theme.`
            : `This is a brief-driven project. The user brief is the primary direction; the included ${spec.selection.styleId} scene is a neutral base for structure, component states and implementation patterns, not the user's selected style. Read .easymint/design/showcase.html AND showcase-mobile.html as that base, then adapt composition, typography, materials and controls to the brief. Never present the base scene as the chosen direction.`
        : `The primary reference is the actual selected scene in .easymint/design/showcase.html AND showcase-mobile.html. Inspect its body, relevant data-style/scene CSS in components.css and handlers in runtime.js before designing. For large files inspect relevant ranges; a truncated read is incomplete. Reuse this actual composition, characteristic materials and useful controls in prototype AND implementation. Adapt the functions to the user's task; do not build the demo's business unnecessarily, do not recreate a generic component catalogue, and do not reduce style selection to a palette swap.`;
    return `Project visual contract v${spec.schemaVersion}, pack ${spec.packVersion}: ${spec.selection.styleId}; palette ${spec.selection.palette}; effect ${spec.selection.effect}. Read .easymint/design/visual-spec.json, .easymint/design/DESIGN.md and .easymint/design/scene-contract.json when present. ${reference} ${brief ? "Reuse only blocks and runtime needed by the brief; base composition, materials and motion are optional. Preserve licenses for reused source." : "Keep the marked theme/component/runtime blocks or import the provided files; preserve source licenses."} The old templates/ and gallery.html are compatibility starters only; use them as a fallback for older packs without a scene, not as the visual direction. For difficult effects, compare runnable licensed implementations on the same background, size and state; preserve the accepted baseline and verify the actual rendered result. For native targets read native-tokens.json and PORTING.md and implement the same visual roles in the real target toolkit. The HTML showcase is a visual and interaction reference, not a native implementation; do not claim parity without a real native preview. Change direction through set_project_design while preserving user content and edits.${brief && !undescribed ? ` User visual brief: ${brief}` : ''}`;
}
