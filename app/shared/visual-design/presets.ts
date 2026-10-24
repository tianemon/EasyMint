import { DEFAULT_APPEARANCE, type StyleAppearance, type StylePalette } from "./appearance";

import { LIGHT_STYLE_COLORS, DARK_STYLE_COLORS, recipe, type StyleDefinition } from "./preset-foundation";
import { EXTRA_STYLE_PRESETS, resolveExtraAppearance } from "./extra-presets";
export { LIGHT_STYLE_COLORS, DARK_STYLE_COLORS } from "./preset-foundation";
export type { StyleDefinition, StyleColorRoles } from "./preset-foundation";

/** Applies even when Mint recommends a style or the user chooses a non-featured style. */
export const STYLE_COLOR_POLICY = "Color policy: use a deliberate palette appropriate to the selected visual style, with one dominant primary action and quieter supporting actions. Supporting actions such as Save must not compete with the main action. Neutral framing is a foundation, not a requirement to remove color or visual interest: meaningful artwork, tonal containers, selected controls and content may use a small coordinated set of clean colors. Do not spread the accent over every region or force every style into black-and-white or blue. Build hierarchy with composition, typography, useful content, scale and spacing before decoration; do not fill the page with arbitrary statistics or identical raised cards. Use green for success, red for real errors/danger and yellow for meaningful warnings with dark labels. Do not default to muddy earth tones, random rainbow cards or neon background glows as a shortcut to material quality. Follow the selected scene palette; any warm neutral must serve the actual content and material rather than replace its design language. Keep ordinary text and active button labels at least 4.5:1 against their surfaces; dark/translucent surfaces need tested foreground contrast. Errors and selected states also need visible text, icons, shape or position cues. Respect each style's material and layout boundaries throughout the entire component system; never reduce style selection to palette swaps.";

export const STYLE_COMPONENT_POLICY = "Scene policy: choose the complete product composition best suited to the task. Do not generate a component inventory or add controls solely to demonstrate a style. Style only useful visible controls and their states consistently with the selected scene, including focus, selection and feedback. Use semantic controls with fully authored visuals, never an unstyled native system select popup. Menu surfaces must match the style, align to the trigger width, handle scrolling/scaling and flip or constrain height at viewport edges. Support pointer and keyboard navigation, Escape/Tab and predictable focus return. Keep feedback visible near the user's current viewport instead of below long scrolling content. Respect reduced motion. Do not add explanatory copy to compensate for inconsistent controls.";

const raised = "5px 5px 12px #cbd2dd, -5px -5px 12px #ffffff";
const inset = "inset 3px 3px 7px #cbd2dd, inset -3px -3px 7px #ffffff";
const flatColors = { ...LIGHT_STYLE_COLORS, accent: "#2546e8", accentSoft: "#e6ebff", onAccentSoft: "#2036a3" };
const materialColors = { ...LIGHT_STYLE_COLORS, accent: "#23634d", accentSoft: "#dceee3", onAccentSoft: "#194c39" };
const reliefColors = { ...LIGHT_STYLE_COLORS, accent: "#425782", accentSoft: "#e0e5f0", onAccentSoft: "#344667" };
const paperColors = { ...LIGHT_STYLE_COLORS, accent: "#a02e40", accentSoft: "#fae6ea", onAccentSoft: "#852638" };

/** Product style recipes, shared by the live samples and the generation context. */
export const STYLE_PRESETS = [
  {
    summary: "creation.style.minimalismSummary",
    id: "minimalism", label: "ui.ProjectFormTypes.minimalism", description: "creation.style.minimalHint",
    colors: LIGHT_STYLE_COLORS,
    artwork: { color: "#e75b60", soft: "#f1f0f5", ink: "#29282f" },
    layout: { web: "Quiet text sidebar; editorial heading; asymmetric featured project with a larger artwork column; thin rules around components rather than repeated raised cards.", mobile: "Compact branded header and concise main action; editorial project artwork before its summary; tasks then project properties; quiet persistent bottom navigation." },
    background: "#ffffff", surface: "#ffffff", ink: "#171717", muted: "#626262", accent: LIGHT_STYLE_COLORS.accent, border: "#e5e5e5", radius: 3, font: "sans-serif", density: "spacious", sidebar: "#ffffff", texture: "none",
    recipes: { card: recipe("#ffffff", "#171717", "1px solid #e5e5e5", 4), primary: recipe("#171717", "#ffffff", "1px solid #171717", 4), secondary: recipe("#ffffff", "#171717", "1px solid #dcdcdc", 4), input: recipe("#ffffff", "#171717", "1px solid #dcdcdc", 4), menu: recipe("#f0f0f2", "#171717", "0 solid transparent", 4) },
    states: { hover: "brightness(0.94)", pressed: "none", focus: `2px solid ${LIGHT_STYLE_COLORS.focus}`, disabled: "1", error: LIGHT_STYLE_COLORS.danger },
    rules: "Minimalism: generous whitespace, precise typography, thin rules and small corners. Editorial composition with a featured project preview, confident type scale and sparse artwork. No decorative gradients, textures or shadows in interface chrome; artwork stays flat too. Navigation uses typography and a thin indicator; inputs use quiet outlines; switches and checkboxes use simple neutral geometry and show accent only when focus needs emphasis.",
  },
  {
    summary: "creation.style.flatSummary",
    id: "flat", label: "ui.ProjectFormTypes.flatDesign", description: "creation.style.flatHint",
    colors: flatColors,
    artwork: { color: "#ed505b", soft: "#ffe4e6", ink: "#252b38" },
    layout: { web: "Horizontal masthead navigation instead of a sidebar; bold split solid-color feature; square components and clearly aligned two-column content.", mobile: "Compact masthead, large geometric poster cover before the project summary, stacked solid-color blocks; square task rows and property fields; flat bottom navigation." },
    background: "#ffffff", surface: "#ffffff", ink: "#171717", muted: "#626262", accent: flatColors.accent, border: "#d9d9d9", radius: 0, font: "sans-serif", density: "comfortable", sidebar: "#ffffff", texture: "none",
    recipes: { card: recipe("#ffffff", "#171717", "0 solid transparent", 0), primary: recipe(flatColors.accent, "#ffffff", `2px solid ${flatColors.accent}`, 0), secondary: recipe("transparent", flatColors.accent, `2px solid ${flatColors.accent}`, 0), input: recipe("#ffffff", "#171717", "2px solid #cbcbcb", 0), menu: recipe("#e6ebff", "#2036a3", "0 solid transparent", 0) },
    states: { hover: "brightness(0.9)", pressed: "none", focus: `2px solid ${LIGHT_STYLE_COLORS.focus}`, disabled: "1", error: LIGHT_STYLE_COLORS.danger },
    rules: "Flat design: strong solid-color blocks, sharp geometry, square controls, horizontal masthead navigation, bold condensed headings, a vivid solid-color/white split hero and geometric artwork. Use solid color and scale, never simulated depth. Strictly NO gradients, box-shadows, text-shadows, blur, gloss or simulated depth, including hover/pressed/disabled states. Selected navigation uses a solid block, inputs have clean two-pixel borders, checkbox is square and filled when checked.",
  },
  {
    summary: "creation.style.materialSummary",
    id: "material", label: "creation.style.material", description: "creation.style.materialHint",
    colors: materialColors,
    artwork: { color: "#4c9778", soft: "#dceee3", ink: "#194c39" },
    layout: { web: "Compact labeled icon rail; tonal feature container with asymmetric rounded shapes; supporting surfaces grouped by role and generous pill actions.", mobile: "Compact app bar and action; artwork first in an asymmetric rounded tonal hero, then its concise summary; grouped rounded task and property containers; bottom navigation with pill selected indicators." },
    background: "#f6f9f7", surface: "#ffffff", ink: "#262626", muted: "#626262", accent: materialColors.accent, border: "#d6e2da", radius: 20, font: "sans-serif", density: "comfortable", sidebar: "#edf4ef", texture: "none",
    recipes: { card: recipe("#ffffff", "#262626", "0 solid transparent", 20, "0 1px 3px #0000000a"), primary: recipe(materialColors.accent, "#ffffff", "0 solid transparent", 24, "0 2px 4px #2a2a2a30"), secondary: recipe(materialColors.accentSoft, materialColors.onAccentSoft, "0 solid transparent", 24), input: recipe("#e9f0eb", "#262626", "0 solid transparent", 4), menu: recipe("#edf4ef", "#194c39", "0 solid transparent", 16, "0 5px 18px #203a2929") },
    states: { hover: "brightness(0.94)", pressed: "none", focus: `2px solid ${LIGHT_STYLE_COLORS.focus}`, disabled: "1", error: LIGHT_STYLE_COLORS.danger },
    rules: "Material Design: tonal surfaces, rounded containers, pill navigation and buttons, restrained elevation on primary content and temporary menus, a compact navigation rail with tonal selected indicators and clear state layers. Supporting settings use a tonal surface without competing elevation. Large asymmetric artwork shapes echo the pill and rounded-rectangle language. Use filled input fields with a two-pixel bottom indicator, small persistent labels, distinct filled switches and accessible focus outlines. A pressed button reduces elevation. Avoid skeuomorphic texture and glossy gradients.",
  },
  {
    summary: "creation.style.glassSummary",
    id: "glass", label: "ui.ProjectFormTypes.glassmorphism", description: "creation.style.glassHint",
    colors: DARK_STYLE_COLORS,
    artwork: { color: "#b4a3f0", soft: "#514969", ink: "#ffffff" },
    layout: { web: "Narrow floating icon navigation; open background with a translucent project window and overlapping glass status; restrained lavender light visible behind major frosted panels.", mobile: "Compact top bar; artwork retains translucent layering; vertically stacked frosted content; stable translucent bottom navigation." },
    background: "#1c2025", surface: "#ffffff12", ink: "#ffffff", muted: "#dedde9", accent: DARK_STYLE_COLORS.accent, border: "#ffffff38", radius: 22, font: "sans-serif", density: "comfortable", sidebar: "#ffffff0d", texture: "radial-gradient(ellipse at 88% 12%, #b4a3f07a 0%, transparent 48%), radial-gradient(ellipse at 8% 55%, #71cfbb40 0%, transparent 40%), radial-gradient(ellipse at 65% 100%, #b4a3f030 0%, transparent 48%)",
    recipes: { card: recipe("linear-gradient(145deg, #ffffff20, #ffffff08)", "#ffffff", "0 solid transparent", 22, "0 12px 28px #080c1824, inset 0 1px 0 #ffffff55, inset 1px 0 0 #ffffff20, inset 0 -1px 0 #ffffff0d"), primary: recipe("#ffffff", "#171717", "1px solid #ffffffa6", 12, "0 3px 10px #19191925"), secondary: recipe("linear-gradient(135deg, #ffffff24, #ffffff0a)", "#ffffff", "0 solid transparent", 12, "inset 0 1px 0 #ffffff65, inset 0 -1px 0 #ffffff18, 0 3px 8px #00000012"), input: recipe("#10141c35", "#ffffff", "0 solid transparent", 12, "inset 0 1px 3px #05091228, 0 1px 0 #ffffff25"), menu: recipe("linear-gradient(145deg, #ffffff12, transparent), #303647d9", "#ffffff", "0 solid transparent", 16, "0 12px 30px #080c1855, inset 0 1px 0 #ffffff80, inset 1px 0 0 #ffffff30, inset 0 -1px 0 #ffffff12") },
    states: { hover: "none", pressed: "inset 0 2px 6px #26262630", focus: `2px solid ${DARK_STYLE_COLORS.focus}`, disabled: "1", error: DARK_STYLE_COLORS.danger },
    rules: "Glassmorphism: uniform stationary frosted panels, restrained translucent fill, fine cool edge highlights and broad soft shadows over a visible ambient composition. Frosted uses 24px backdrop blur; clear uses 4px and a lighter fill. Keep panel silhouettes stable and interaction subdued. This material does not refract or displace the background; reserve optical lenses and elastic controls for Liquid Glass. Text needs a dependable dark-tinted backing. Reuse the AURA workspace source in showcase.html and gx-* styles for this direction. Do not animate blur or blur every nested child.",
  },
  {
    summary: "creation.style.neumorphismSummary",
    id: "neumorphism", label: "ui.ProjectFormTypes.neumorphism", description: "creation.style.neumorphismHint",
    colors: reliefColors,
    artwork: { color: "#647fae", soft: "#e9edf3", ink: "#344667" },
    layout: { web: "Continuous cool pale surface; recessed text navigation; broad feature paired with a raised circular progress instrument instead of a window thumbnail; tasks and fields share one light source.", mobile: "Compact header; circular progress instrument alongside concise project summary; full-width recessed fields and raised actions; anchored bottom navigation." },
    background: "#e9edf3", surface: "#e9edf3", ink: "#262626", muted: "#626262", accent: reliefColors.accent, border: "#cad2df", radius: 18, font: "sans-serif", density: "comfortable", sidebar: "#e9edf3", texture: "none",
    recipes: { card: recipe("#e9edf3", "#262626", "1px solid #ffffff40", 18, raised), primary: recipe("#e9edf3", reliefColors.accent, "1px solid #ffffff60", 12, raised), secondary: recipe("#e9edf3", "#425782", "0 solid transparent", 12, "2px 2px 5px #cbd2dd, -2px -2px 5px #ffffff"), input: recipe("#e9edf3", "#262626", "1px solid transparent", 10, inset), menu: recipe("#e9edf3", "#262626", "0 solid transparent", 12, raised) },
    states: { hover: "brightness(1.015)", pressed: inset, focus: `2px solid ${LIGHT_STYLE_COLORS.focus}`, disabled: "1", error: LIGHT_STYLE_COLORS.danger },
    rules: "Neumorphism: one continuous cool pale surface, one top-left light source, paired neutral gray/white extrusion shadows on cards and buttons, paired inset shadows on fields and tracks. Button press and selected navigation become recessed, switch knob is raised above a recessed track. Use a raised circular progress dial as the feature visual; its center and track have distinct extrusion/inset. Preserve a visible focus ring and readable labels; no glossy gradients, leather or arbitrary colored cards.",
  },
  {
    summary: "creation.style.skeuomorphismSummary",
    id: "skeuomorphism", label: "ui.ProjectFormTypes.skeuomorphism", description: "creation.style.skeuomorphismHint",
    colors: paperColors,
    artwork: { color: "#b83d50", soft: "#f1f2f5", ink: "#303541" },
    layout: { web: "Graphite bound spine with tabs, white paper content and small metal rings; serif editorial project heading, framed printed study, mechanical reminder switch, movable bookmark and tactile ink pencils.", mobile: "Pocket planner with small binder header, paper project cover before a concise summary and red index tab; ruled tasks, recessed form fields, physical bookmark and mechanical bottom navigation." },
    background: "#f4f4f4", surface: "#ffffff", ink: "#262626", muted: "#626262", accent: paperColors.accent, border: "#b8b8b8", radius: 6, font: "Georgia, serif", density: "comfortable", sidebar: "#303030", texture: "repeating-linear-gradient(0deg, #69696907 0px, #69696907 1px, transparent 1px, transparent 4px)",
    recipes: { card: recipe("#ffffff", "#262626", "1px solid #c4c4c4", 6, "0 2px 0 #c5c5c5, 0 4px 9px #59595918, inset 0 1px 0 #ffffff"), primary: recipe("linear-gradient(#bd4354, #952c3e)", "#ffffff", "1px solid #892b3c", 6, "inset 0 1px 0 #ffffff65, 0 3px 0 #782334, 0 4px 5px #3a3a3a35"), secondary: recipe("linear-gradient(#fefefe, #d6d6d6)", "#4d4d4d", "1px solid #ababab", 6, "inset 0 1px 0 #ffffff, 0 2px 0 #ababab"), input: recipe("#fdfdfd", "#262626", "1px solid #a9a9a9", 4, "inset 0 2px 4px #59595926, 0 1px 0 #ffffff"), menu: recipe("linear-gradient(#ffffff, #edeff3)", "#303541", "0 solid transparent", 6, "0 2px 0 #b7bcc8, 0 6px 14px #30354130, inset 0 1px 0 #ffffff") },
    states: { hover: "brightness(1.04)", pressed: "inset 0 2px 5px #36363645, 0 1px 0 #444444", focus: `2px solid ${LIGHT_STYLE_COLORS.focus}`, disabled: "1", error: LIGHT_STYLE_COLORS.danger },
    rules: "Skeuomorphism: a contemporary physical planner with restrained colored index tabs and a framed printed project preview, black fine-grain soft-touch navigation with fine stitched edges, cool white subtly ruled paper, serif headings and small metal binder details. Use beveled solid buttons with a top highlight and lower cast shadow, recessed white fields, tactile checkboxes and a mechanical sliding switch with a metallic knob. Maintain one consistent light source. The texture must remain subtle behind content; never substitute neumorphic monochrome puffs for these materials.",
  },
  ...EXTRA_STYLE_PRESETS,
] as const satisfies readonly StyleDefinition[];

export type StylePreset = Omit<StyleDefinition, "id"> & { id: typeof STYLE_PRESETS[number]["id"]; appearance?: StyleAppearance };
export type PreviewDevice = "web" | "mobile";

export const APPEARANCE_PALETTES: Record<Exclude<StylePalette, "default">, { accent: string; soft: string; ink: string; art: string; dark: string; darkSoft: string; darkMenu: string }> = {
  mono: { accent: "#262626", soft: "#eeeeee", ink: "#171717", art: "#686868", dark: "#eeeeee", darkSoft: "#ffffff1f", darkMenu: "#343434d9" },
  coral: { accent: "#b82d42", soft: "#ffe5ea", ink: "#872335", art: "#ed5968", dark: "#ffd0da", darkSoft: "#ffd0da22", darkMenu: "#49353fd9" },
  green: { accent: "#23634d", soft: "#dceee3", ink: "#194c39", art: "#4c9778", dark: "#b9edd5", darkSoft: "#b9edd522", darkMenu: "#2c3e39d9" },
  violet: { accent: "#6546a4", soft: "#eee5fc", ink: "#503580", art: "#9c80d2", dark: "#e1d0ff", darkSoft: "#e1d0ff22", darkMenu: "#39364ed9" },
};

/** Resolve the same appearance for the catalog, layout sample and generation handoff. */
export function resolveStylePreset(base: StylePreset, appearance: StyleAppearance = DEFAULT_APPEARANCE): StylePreset {
  const preset: StylePreset = { ...base, appearance, colors: { ...base.colors }, artwork: { ...base.artwork }, states: { ...base.states }, recipes: Object.fromEntries(Object.entries(base.recipes).map(([key, value]) => [key, { ...value }])) as StylePreset["recipes"] };
  const palette = appearance.palette === "default" ? null : APPEARANCE_PALETTES[appearance.palette];
  if (EXTRA_STYLE_PRESETS.some(item => item.id === base.id)) return resolveExtraAppearance(preset, appearance, palette);
  if (palette) {
    const dark = base.id === "glass";
    const accent = dark ? palette.dark : palette.accent;
    const soft = dark ? palette.darkSoft : palette.soft;
    const ink = dark ? palette.dark : palette.ink;
    preset.colors = { ...preset.colors, accent, accentSoft: soft, onAccentSoft: ink, focus: accent };
    preset.accent = accent;
    preset.states.focus = `2px solid ${accent}`;
    preset.artwork = { color: dark ? palette.dark : palette.art, soft: palette.soft, ink: dark ? "#ffffff" : palette.ink };
    if (dark) {
      preset.background = appearance.palette === "mono" ? "#242424" : "#242432";
      preset.texture = `radial-gradient(ellipse at 80% 10%, ${palette.art}44, transparent 55%)`;
      preset.recipes.primary = { ...preset.recipes.primary, background: accent, color: "#242432", border: "0 solid transparent" };
      preset.recipes.menu = { ...preset.recipes.menu, background: `linear-gradient(145deg, #ffffff12, transparent), ${palette.darkMenu}` };
    } else {
      if (base.id === "material") {
        preset.background = `color-mix(in srgb, ${palette.soft} 20%, #ffffff)`;
        preset.sidebar = `color-mix(in srgb, ${palette.soft} 65%, #ffffff)`;
        preset.recipes.input.background = `color-mix(in srgb, ${palette.soft} 60%, #ffffff)`;
        preset.recipes.secondary.background = palette.soft;
        preset.recipes.menu.background = `color-mix(in srgb, ${palette.soft} 65%, #ffffff)`;
      } else if (base.id === "flat") {
        preset.recipes.secondary.border = `2px solid ${accent}`;
        preset.recipes.menu.background = palette.soft;
      } else if (base.id === "minimalism") preset.recipes.menu.background = palette.soft;
      if (base.id === "neumorphism") preset.recipes.primary.color = accent;
      else preset.recipes.primary = { ...preset.recipes.primary, background: base.id === "skeuomorphism" ? `linear-gradient(${accent}, color-mix(in srgb, ${accent} 85%, #000000))` : accent, color: "#ffffff", border: base.id === "flat" ? `2px solid ${accent}` : "0 solid transparent" };
      preset.recipes.secondary.color = accent;
      preset.recipes.menu.color = palette.ink;
    }
  }
  if (appearance.effect === "subtle") {
    if (base.id === "minimalism") preset.density = "compact";
    if (base.id === "flat") { preset.artwork.color = `color-mix(in srgb, ${preset.artwork.color} 75%, #ffffff)`; preset.artwork.soft = `color-mix(in srgb, ${preset.artwork.soft} 60%, #ffffff)`; }
    if (base.id === "material") {
      preset.recipes.card.shadow = "none";
      preset.recipes.primary.shadow = "none";
      preset.recipes.menu.shadow = "0 3px 10px #203a2918";
    }
    if (base.id === "glass") preset.recipes.card.background = "#ffffff14";
    if (base.id === "neumorphism") {
      const lift = "3px 3px 7px #cbd2dd, -3px -3px 7px #ffffff";
      const recess = "inset 2px 2px 4px #cbd2dd, inset -2px -2px 4px #ffffff";
      for (const key of ["card", "primary", "menu"] as const) preset.recipes[key].shadow = lift;
      preset.recipes.input.shadow = recess;
      preset.states.pressed = recess;
    }
    if (base.id === "skeuomorphism") {
      preset.texture = "repeating-linear-gradient(0deg, #69696904 0px, #69696904 1px, transparent 1px, transparent 4px)";
      preset.recipes.card.shadow = "0 1px 0 #c5c5c5, 0 2px 5px #59595912";
    }
  }
  if (appearance.palette === "mono") {
    preset.border = "#d3d3d3";
    if (base.id === "neumorphism") {
      preset.background = "#e9e9e9"; preset.sidebar = "#e9e9e9"; preset.surface = "#e9e9e9";
      for (const recipe of Object.values(preset.recipes)) { recipe.background = recipe.background.replaceAll("#e9edf3", "#e9e9e9"); recipe.shadow = recipe.shadow.replaceAll("#cbd2dd", "#d0d0d0"); }
    }
  }
  return preset;
}

export function sampleStyle(preset: StylePreset): Record<string, string> {
  const style: Record<string, string> = {
    "--sample-bg": preset.background, "--sample-surface": preset.surface, "--sample-ink": preset.ink,
    "--sample-muted": preset.muted, "--sample-accent": preset.accent, "--sample-border": preset.border,
    "--sample-radius": `${preset.radius}px`, "--sample-font": preset.font, "--sample-sidebar": preset.sidebar,
    "--sample-texture": preset.texture, "--sample-hover": preset.states.hover, "--sample-pressed": preset.states.pressed,
    "--sample-focus": preset.states.focus, "--sample-disabled": preset.states.disabled, "--sample-error": preset.states.error,
    "--sample-accent-soft": preset.colors.accentSoft, "--sample-on-accent-soft": preset.colors.onAccentSoft,
    "--sample-art-color": preset.artwork.color, "--sample-art-soft": preset.artwork.soft, "--sample-art-ink": preset.artwork.ink,
    "--sample-success": preset.colors.success, "--sample-warning": preset.colors.warning, "--sample-on-warning": preset.colors.onWarning,
    "--sample-on-danger": preset.id === "glass" || preset.tone === "dark" ? preset.background : "#ffffff",
  };
  const primary = preset.recipes.primary;
  const darkLabel = /^#[0-9a-f]{6}$/i.test(primary.color) && [1,3,5].reduce((sum,i)=>sum+parseInt(primary.color.slice(i,i+2),16),0)<384;
  style["--sample-primary-hover-background"] = /^#[0-9a-f]{6}$/i.test(primary.background) ? `color-mix(in srgb,${primary.background} 94%,${darkLabel?"#ffffff":"#000000"})` : primary.background;
  for (const [name, recipe] of Object.entries(preset.recipes)) for (const [key, value] of Object.entries(recipe)) style[`--sample-${name}-${key}`] = value;
  if (preset.blur !== undefined) style["--visual-blur"] = `${preset.blur}px`;
  for (const [key,value] of Object.entries(preset.scales?.fontSize ?? {})) style[`--visual-font-${key}`] = `${value}px`;
  for (const [key,value] of Object.entries(preset.scales?.spacing ?? {})) style[`--visual-space-${key}`] = `${value}px`;
  return style;
}
