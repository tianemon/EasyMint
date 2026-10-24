import { LIGHT_STYLE_COLORS, DARK_STYLE_COLORS, recipe as r, type StyleDefinition } from "./preset-foundation";

interface Direction {
  accent: string; soft: string; onSoft: string; artwork: StyleDefinition["artwork"];
  layout: StyleDefinition["layout"]; rules: string;
  background?: string; ink?: string; muted?: string; border?: string; radius?: number;
  tone?: "light" | "dark"; font?: string; texture?: string; density?: string;
  recipes?: Partial<StyleDefinition["recipes"]>;
}
function direction<const T extends string>(id: T, config: Direction): StyleDefinition & { id: T } {
  const dark = config.tone === "dark", ink = config.ink ?? (dark ? "#edf2f8" : "#20222b");
  const surface = dark ? "#1c232e" : "#ffffff", radius = config.radius ?? 12;
  const roles = { ...(dark ? DARK_STYLE_COLORS : LIGHT_STYLE_COLORS), accent: config.accent, accentSoft: config.soft, onAccentSoft: config.onSoft };
  return {
    id, label: `creation.style.${id}.name`, summary: `creation.style.${id}.summary`, description: `creation.style.${id}.hint`,
    tone: config.tone ?? "light", colors: roles, artwork: config.artwork,
    layout: config.layout, background: config.background ?? "#f6f7fb", surface, ink,
    muted: config.muted ?? (dark ? "#b7c3d2" : "#606676"), accent: config.accent,
    border: config.border ?? (dark ? "#3b4654" : "#dce0ea"), radius,
    font: config.font ?? "system-ui, sans-serif", density: config.density ?? "comfortable",
    sidebar: dark ? "#121923" : "#ffffff", texture: config.texture ?? "none",
    recipes: {
      card: r(surface, ink, "0 solid transparent", radius),
      primary: r(config.accent, dark ? "#101923" : "#ffffff", "0 solid transparent", radius),
      secondary: r(config.soft, config.onSoft, "0 solid transparent", radius),
      input: r(dark ? "#101923" : "#f3f5fa", ink, "0 solid transparent", Math.max(4,radius-4)),
      menu: r(dark ? "#293342" : "#ffffff", ink, "0 solid transparent", radius, dark ? "0 12px 30px #00000066" : "0 10px 28px #24304b24"),
      ...config.recipes,
    },
    states: { hover: "none", pressed: "none", focus: `2px solid ${dark ? "#a6e2f4" : "#475db2"}`, disabled: "1", error: roles.danger },
    rules: config.rules,
  };
}
const clayShadow = "12px 14px 26px #6e68aa27, inset -7px -8px 14px #8c82bd30, inset 5px 7px 14px #ffffffd9";
const hardShadow = "4px 4px 0 #20222b";

export const EXTRA_STYLE_PRESETS = [
  direction("liquid-glass", {
    accent: "#27323f", soft: "#e8eef4", onSoft: "#27323f", background: "#f0f3f7", radius: 26,
    artwork: { color: "#7c9ac6", soft: "#dce9ef", ink: "#203147" },
    recipes: {card:r("#ffffff", "#20222b", "0 solid transparent",24),primary:r("#27323f","#ffffff","0 solid transparent",28,"inset 0 1px 1px #ffffff65, 0 3px 8px #26394c20"),secondary:r("#ffffff9c","#27323f","0 solid transparent",28,"inset 0 1px 1px #ffffffed, inset 0 -1px 2px #20334b25, 0 4px 12px #26394c14"),input:r("#ffffffb3","#20222b","0 solid transparent",24,"inset 0 1px 3px #192e4212"),menu:r("#f8fbfff2","#20222b","0 solid transparent",24,"inset 0 1px 0 #ffffff, 0 18px 40px #20374c2e")},
    layout:{web:"Quiet opaque content beneath floating rounded optical navigation and toolbars; media-led landscape with distinct functional layers.",mobile:"Content-first full-width media and opaque cards; compact floating bottom navigation and glass controls separated from content."},
    rules:"Liquid Glass inspired by Apple HIG: use optical, rounded material on functional navigation, toolbars and transient controls, not every content card. Clear edge highlights and inner optical shading over rich content; opaque content remains readable. The selected SONORA material defaults to clear over media; retain regular with stronger diffusion when legibility requires it. The SONORA sample demonstrates a floating tab bar, separate search affordance, mini-player accessory, expanding player and interactive sliders. Keep a stable neutral film while background colours transmit continuously; do not switch the whole surface theme at scroll thresholds. Clear glyph contrast adapts locally. The selected tab capsule follows dragging and settles with a spring. Use the adopted C optical implementation: squircle surface, Fresnel-weighted refraction and reflection, bezel 10px, base thickness 0.8 and gain 1.5, with a shared smooth inner shoulder. Preview and exported runtime share this engine; do not replace it with a blur-only imitation. Web CSS is an approximation, not Apple's native refraction renderer. Keep controls semantically accessible; reduced transparency gets an opaque fallback.",
  }),
  direction("claymorphism", {
    accent:"#65459b",soft:"#eae0fa",onSoft:"#4e347b",background:"#f4f1fb",radius:28,font:"ui-rounded, system-ui, sans-serif",
    artwork:{color:"#a18adc",soft:"#f5dce9",ink:"#47376d"},
    recipes:{card:r("#f0e9fb","#302942","0 solid transparent",30,clayShadow),primary:r("#65459b","#ffffff","0 solid transparent",22,"0 7px 15px #65459b33, inset 0 3px 6px #ffffff50, inset 0 -4px 7px #35205450"),secondary:r("#e4d9f5","#473168","0 solid transparent",22,clayShadow),input:r("#ffffff","#302942","0 solid transparent",18,"inset 2px 3px 7px #8170ac22, 0 1px 0 #ffffff"),menu:r("#eee6fa","#302942","0 solid transparent",26,clayShadow)},
    layout:{web:"Inflated independent containers, a sculptural clay study beside rounded typography; generous breathing room separates objects.",mobile:"Friendly rounded masthead, a small clay sculpture followed by puffy task groups; large accessible soft controls."},
    rules:"Claymorphism: independent inflated objects with an outer cast shadow plus contrasting inner highlights and inner shading; large rounded silhouettes and clean pastel color. Unlike neumorphism, objects differ from the background rather than extruding one continuous material. Keep readable dark text; no muddy clay/brown colors.",
  }),
  direction("business", {
    accent:"#34445b",soft:"#e7edf5",onSoft:"#26394f",background:"#f3f5f8",radius:4,density:"compact",
    artwork:{color:"#455d7f",soft:"#e4ebf4",ink:"#26394f"},
    recipes:{card:r("#ffffff","#242b36","1px solid #e0e5ed",4),primary:r("#34445b","#ffffff","0 solid transparent",4),secondary:r("#ffffff","#34445b","1px solid #bbc5d3",4),input:r("#ffffff","#242b36","1px solid #b8c3d1",4),menu:r("#ffffff","#242b36","1px solid #d9e0e9",4,"0 5px 18px #25354c25")},
    layout:{web:"Enterprise workbench: anchored navigation, aligned columns, compact toolbar, readable dense table and restrained summary regions.",mobile:"Compact labeled navigation, prioritized task rows and responsive data summaries; preserve operations instead of squeezing a desktop table."},
    rules:"Business is a purpose, interpreted here as an enterprise workbench informed by Carbon grid and density. Use predictable alignment, compact square geometry, clearly labeled actions and low decorative weight. Avoid default blue SaaS marketing heroes and oversized repeated cards.",
  }),
  direction("luxury", {
    accent:"#332b46",soft:"#eeeaf4",onSoft:"#332b46",background:"#fcfcfe",radius:2,font:"Georgia, 'Songti SC', serif",density:"spacious",
    artwork:{color:"#3d334e",soft:"#eef0f5",ink:"#ffffff"},
    recipes:{card:r("#ffffff","#25232c","0 solid transparent",2),primary:r("#332b46","#ffffff","0 solid transparent",2),secondary:r("transparent","#332b46","1px solid #9f98ac",2),input:r("#f8f8fc","#25232c","1px solid #c6c1cd",2),menu:r("#ffffff","#25232c","1px solid #dcd8e4",2,"0 12px 30px #26213114")},
    layout:{web:"Atelier composition: generous margins, tall contrasting artwork, refined display type and small widely tracked navigation; limited precise rules.",mobile:"Large display statement paired with a tall object study; concise linear detail list, elegantly sized controls and generous breathing room."},
    rules:"Luxury is art direction rather than black-and-gold decoration. Use precise proportion, editorial display type, restrained cool-white/ink/silver surfaces, tall imagery and fine craftsmanship. No gold/brown palette, ornamental glow, excessive borders or tiny unreadable labels. Use available local typefaces consistently.",
  }),
  direction("bento", {
    accent:"#35446f",soft:"#e7ebf8",onSoft:"#2f3d68",background:"#f1f3f8",radius:24,
    artwork:{color:"#7d8fc5",soft:"#e7ebfa",ink:"#263555"},
    recipes:{card:r("#ffffff","#252b3b","0 solid transparent",24),primary:r("#35446f","#ffffff","0 solid transparent",18),secondary:r("#e7ebf8","#2f3d68","0 solid transparent",18),input:r("#edf0f7","#252b3b","0 solid transparent",14),menu:r("#ffffff","#252b3b","0 solid transparent",20,"0 10px 25px #34446b22")},
    layout:{web:"A modular composition with deliberately different row/column spans; one large content tile balanced by compact supporting tiles, consistent gutters.",mobile:"Reorder large and small modules by task importance; retain an intentional two-width rhythm on wide mobile instead of shrinking the whole grid."},
    rules:"Bento is a layout system, not a special material: uneven but aligned modular cells, varied spans and deliberate content roles. Each module has a purpose; avoid an equal-card dashboard disguised only by rounded corners. Maintain consistent gutters and readable mobile ordering.",
  }),
  direction("colorful", {
    accent:"#623aa2",soft:"#eee5fa",onSoft:"#4f2c87",background:"#ffffff",radius:14,
    artwork:{color:"#7050c1",soft:"#e9defc",ink:"#302447"},
    recipes:{card:r("#f3edfc","#302447","0 solid transparent",16),primary:r("#623aa2","#ffffff","0 solid transparent",12),secondary:r("#e1f1eb","#23523f","0 solid transparent",12),input:r("#ffffff","#302447","1px solid #c7b9dd",10),menu:r("#f5f0ff","#302447","0 solid transparent",14,"0 10px 24px #4a28762b")},
    layout:{web:"An expressive chromatic composition with confident typography and distinct color-coded content regions; neutral breathing room keeps actions clear.",mobile:"Bold useful color blocks and expressive geometry, concise task ordering, clean readable inputs and restrained active color."},
    rules:"Colorful design uses a coordinated limited set of clean hues as content organization, informed by graphic identity systems such as Cooper Hewitt. Keep a dominant primary action and quieter support. No rainbow-per-card, multicolor glow, random gradients or loss of contrast.",
  }),
  direction("retro", {
    accent:"#ad2d49",soft:"#fbe0e8",onSoft:"#842039",background:"#ffffff",radius:0,font:"'Courier New', 'PingFang SC', monospace",
    artwork:{color:"#f0ce46",soft:"#fce7ed",ink:"#20222b"},texture:"radial-gradient(#20222b09 .6px,transparent .6px)",
    recipes:{card:r("#ffffff","#20222b","2px solid #20222b",0,hardShadow),primary:r("#ad2d49","#ffffff","2px solid #20222b",0,hardShadow),secondary:r("#ffffff","#20222b","2px solid #20222b",0,"3px 3px 0 #20222b"),input:r("#ffffff","#20222b","2px solid #20222b",0,"inset 2px 2px 0 #20222b16"),menu:r("#ffffff","#20222b","2px solid #20222b",0,"5px 5px 0 #20222b")},
    layout:{web:"Retro graphic print: heavy masthead, geometric poster, halftone details, offset hard shadows and outlined content blocks.",mobile:"Poster-like title and graphic cover, bold outlined groups and tactile offset buttons; protect reading width and touch targets."},
    rules:"Retro is explicitly interpreted as geometric postmodern/pop-print inspired by Memphis, not a claim that Memphis equals Y2K. Hard offset shadows, bold outlines, dots and geometric cutouts differentiate it from flat design. No sepia paper, muddy orange, brown or continuous soft gradients.",
  }),
  direction("soft", {
    accent:"#586288",soft:"#e8edf8",onSoft:"#3e496b",background:"#f7f9fd",radius:24,font:"ui-rounded, system-ui, sans-serif",
    artwork:{color:"#a9bbd7",soft:"#e0f1ec",ink:"#415477"},
    recipes:{card:r("#ffffff","#30384c","0 solid transparent",26,"0 5px 18px #7a8eae12"),primary:r("#586288","#ffffff","0 solid transparent",24),secondary:r("#e6f1ec","#34584b","0 solid transparent",24),input:r("#eef2f9","#30384c","0 solid transparent",18),menu:r("#ffffff","#30384c","0 solid transparent",22,"0 9px 25px #63779924")},
    layout:{web:"A calm flowing composition with soft organic artwork, rounded typography and lightly grouped content; spacious but still useful.",mobile:"Gentle header, flowing cover and clear task groups; pill actions and accessible fields without inflated clay depth."},
    rules:"Soft/calm is a mood interpreted through organic shapes, clear gentle typography, cool clean pastels and measured pacing. Distinguish it from puffy clay and low-contrast neumorphism: shallow surfaces, limited shadow and legible labels. No muddy earth colors or very pale tiny text.",
  }),
  direction("editorial", {
    accent:"#823347",soft:"#f6e9ed",onSoft:"#6e293c",background:"#ffffff",radius:0,font:"Georgia, 'Songti SC', serif",density:"spacious",
    artwork:{color:"#b74259",soft:"#eef0f5",ink:"#25262c"},
    recipes:{card:r("transparent","#25262c","0 solid transparent",0),primary:r("#25262c","#ffffff","0 solid transparent",0),secondary:r("transparent","#25262c","1px solid #96969c",0),input:r("#f6f6f8","#25262c","1px solid #c5c5ce",0),menu:r("#ffffff","#25262c","1px solid #d7d7de",0,"0 8px 20px #25262c14")},
    layout:{web:"Magazine composition with a masthead, folio-like details, dramatic serif headline, strong column alignment and an image/text editorial rhythm.",mobile:"Display headline and lead before a full-width cover; short reading measure, rules and byline-like hierarchy; controls remain usable."},
    rules:"Editorial design separates display, reading and small metadata roles, informed by publication typography. Use mastheads, column rules, readable measures and clear hierarchy rather than just putting a serif font on an ordinary dashboard. Do not embed commercial fonts; reuse available local stacks and keep real product content first.",
  }),
  direction("dark", {
    accent:"#c9b8ff",soft:"#2d273f",onSoft:"#ede5ff",background:"#101114",tone:"dark",radius:10,muted:"#a6a6b3",border:"#2c2c35",
    artwork:{color:"#bca5e7",soft:"#342a49",ink:"#ececf2"},
    recipes:{card:r("#1a1a21","#ececf2","1px solid #30303a",12),primary:r("#c9b8ff","#1e1637","0 solid transparent",8),secondary:r("#2d273f","#ede5ff","0 solid transparent",8),input:r("#131318","#ececf2","1px solid #3a3a47",8),menu:r("#2c2c38","#ececf2","1px solid #4b465e",10,"0 14px 32px #00000080")},
    layout:{web:"Low-light workbench with separate sunken, default, raised and overlay surfaces; restrained type and compact useful content.",mobile:"Readable low-light cards and compact navigation; brighter transient layers preserve focus and controls without broad glow."},
    rules:"Dark is a theme interpreted as a low-light workbench. Elevation needs distinct surface luminance as well as shadow, following Atlassian guidance. Avoid pure-black/pure-white flattening, transparent gray stacks, tiny dim text and decorative glass. Selected, disabled, focus and overlay states must stay legible.",
  }),
  direction("tech", {
    accent:"#95f8e2",soft:"#103333",onSoft:"#b9fff0",background:"#030b0f",ink:"#dcf6f5",muted:"#87afb5",border:"#1e4549",tone:"dark",radius:2,font:"'Courier New', 'PingFang SC', monospace",
    artwork:{color:"#46f3e7",soft:"#0b292b",ink:"#d8fff5"},texture:"linear-gradient(#46f3e706 1px,transparent 1px),linear-gradient(90deg,#46f3e706 1px,transparent 1px)",
    recipes:{card:r("#092124","#dcf6f5","1px solid #1e4549",2),primary:r("#95f8e2","#07281f","0 solid transparent",0),secondary:r("#103333","#b9fff0","1px solid #326c66",0),input:r("#061819","#dcf6f5","1px solid #326c66",2),menu:r("#10312f","#dcf6f5","1px solid #528b7e",2,"0 10px 28px #00000065")},
    layout:{web:"Cyberpunk network terminal: central live rotating cyan globe with radial ticks and node links, narrow left relay traffic and right telemetry columns, cyan commands and a compact event log.",mobile:"Retain the holographic sphere, drop auxiliary relay chrome and reflow telemetry below it. Preserve readable labels, clear signal colours and angular controls."},
    rules:"Use the selected NEXUS scene HTML, CSS and SVG as the implementation reference, informed by the archived 22-hud cyberpunk study. Match the reference palette: near-black ink, ion-cyan emissive signals, cool-white data. No purple, violet, magenta or rainbow accents are deliberate roles. Neon mode is an angular vector globe over a perspective grid with emissive coasts and moving packets. Holographic mode is a volumetric dotted-land sphere with suspended orbital rings and a luminous scanning layer. The difference must be structural and obvious in a still image as well as in motion. Use the original canvas renderer in the shared scene runtime; do not substitute a static illustration. Build layered radial scales, spherical grid, network paths and restrained signal bloom. No full-screen flashing, blurred body text or random neon cards. Diagnostic motion must respond to interaction and respect reduced motion. Keep all data explicitly demonstrative until wired to real state.",
  }),
] as const;

import type { StyleAppearance } from "./appearance";
import type { APPEARANCE_PALETTES, StylePreset } from "./presets";
export function resolveExtraAppearance(preset: StylePreset, appearance: StyleAppearance, palette: typeof APPEARANCE_PALETTES["coral"] | null): StylePreset {
  if (palette) {
    const dark = preset.tone === "dark", old = {...preset.colors};
    const accent = dark ? palette.dark : palette.accent, soft = dark ? palette.darkSoft : palette.soft, onSoft = dark ? palette.dark : palette.ink;
    for (const recipe of Object.values(preset.recipes)) {
      const color = recipe.color;
      for (const property of ["background","border","shadow"] as const) recipe[property] = recipe[property].replaceAll(old.accentSoft,soft).replaceAll(old.accent,accent);
      recipe.color = color === old.onAccentSoft ? onSoft : color === old.accent ? accent : color;
    }
    preset.accent=accent; preset.colors={...preset.colors,accent,accentSoft:soft,onAccentSoft:onSoft,focus:accent};
    preset.states.focus=`2px solid ${accent}`;
    preset.artwork={color:dark?palette.dark:palette.art,soft:palette.soft,ink:dark?"#e9ffff":palette.ink};
    if (["claymorphism","soft","bento"].includes(preset.id)) preset.background=`color-mix(in srgb,${palette.soft} 35%,#ffffff)`;
    if(preset.id==="claymorphism"||preset.id==="colorful")preset.recipes.card.background=`color-mix(in srgb,${soft} 55%,#ffffff)`;
    if(preset.id==="claymorphism")preset.recipes.menu.background=`color-mix(in srgb,${soft} 75%,#ffffff)`;
    if(preset.id==="claymorphism")for(const key of ["card","secondary","menu"] as const)preset.recipes[key].shadow=`10px 12px 24px color-mix(in srgb,${accent} 18%,transparent),inset -7px -8px 14px color-mix(in srgb,${accent} 15%,transparent),inset 5px 7px 14px #ffffffd9`;
  }
  if (appearance.effect === "subtle") {
    if(preset.id==="claymorphism")for(const key of ["card","secondary","menu"] as const)preset.recipes[key].shadow="4px 5px 12px #4c437d18,inset -3px -4px 7px #8c82bd20,inset 3px 4px 8px #ffffffd9";
    if(preset.id==="retro")for(const key of ["card","primary","secondary","menu"] as const)preset.recipes[key].shadow="2px 2px 0 #20222b";
    if(preset.id==="soft")preset.recipes.card.shadow="none";
    if(preset.id==="bento")for(const key of ["card","menu"] as const)preset.recipes[key].radius="16px";
    if(preset.id==="liquid-glass")preset.recipes.secondary.shadow="inset 0 1px 1px #ffffffed,0 2px 6px #20334b14";
    if(preset.id==="colorful")preset.artwork.color=`color-mix(in srgb,${preset.artwork.color} 70%,#ffffff)`;
    if(preset.id==="business"||preset.id==="editorial")preset.density="compact";
    if(preset.id==="tech")preset.texture="none";
    if(preset.id==="dark")preset.recipes.card.background="#1a1a21";
    if(preset.id==="luxury")preset.recipes.card.background="#fafafd";
  }
  if(appearance.palette==="mono") {
    const gray=(css:string)=>css.replace(/#[\da-f]{8}|#[\da-f]{6}/gi,hex=>{
      const channels=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      const l=channels[0]!*.2126+channels[1]!*.7152+channels[2]!*.0722;
      const encoded=Math.round((l<=.0031308?l*12.92:1.055*l**(1/2.4)-.055)*255).toString(16).padStart(2,'0');
      return '#'+encoded.repeat(3)+hex.slice(7);
    });
    for(const key of ['background','surface','sidebar','texture','ink','muted','border'] as const)preset[key]=gray(preset[key]);
    for(const recipe of Object.values(preset.recipes))for(const key of Object.keys(recipe) as (keyof typeof recipe)[])recipe[key]=gray(recipe[key]);
  }
  return preset;
}
