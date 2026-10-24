import { describe, expect, it, vi } from "vitest";

vi.mock("../../stores/settings-store", () => ({ useSettingsStore: { getState: () => ({ defaultProjectDir: "/projects" }) } }));
const { parseProjectDraft } = await import("./project-draft");
const { DEFAULT_DATA, UI_STYLE_OPTIONS } = await import("./ProjectFormTypes");
const { createVisualSpec, presetFromVisualSpec } = await import("../../../../shared/visual-design/spec");
const { STYLE_PRESETS, presetDesignContext, resolveStylePreset } = await import("./style-presets");

describe("project creation recovery", () => {
  it("restores editable values without restoring runtime identity or mutating defaults", () => {
    const original = structuredClone(DEFAULT_DATA);
    const result = parseProjectDraft(JSON.stringify({ step: 2, data: { ...DEFAULT_DATA, name: "My project", uiStyle: "soft", features: [{ name: "Search" }], projectId: "old", sessionId: "stale" } }));
    expect(result?.step).toBe(2);
    expect(result?.data.uiStyle).toBe("soft");
    expect(result?.data).not.toHaveProperty("projectId");
    expect(result?.data).not.toHaveProperty("sessionId");
    expect(DEFAULT_DATA).toEqual(original);
  });

  it("recovers from invalid fields and returns incomplete drafts to the first step", () => {
    const result = parseProjectDraft(JSON.stringify({ step: 99, data: { name: "", targets: [null], features: [null, {}, { name: "Useful" }], techBudget: "invalid", deployPlatform: false } }));
    expect(result?.step).toBe(0);
    expect(result?.data.targets).toEqual(DEFAULT_DATA.targets);
    expect(result?.data.features).toEqual([{ name: "Useful" }]);
    expect(result?.data.techBudget).toBe(DEFAULT_DATA.techBudget);
    expect(result?.data.deployPlatform).toBe(DEFAULT_DATA.deployPlatform);
    expect(parseProjectDraft(null)).toBeNull();
    expect(parseProjectDraft(JSON.stringify({ data: null }))).toBeNull();
  });
});

describe("visual preset generation handoff", () => {
  it("implements every listed non-custom style instead of accepting placeholder-only choices", () => {
    expect(new Set(UI_STYLE_OPTIONS.filter(option=>option.value!=="custom").map(option=>option.value))).toEqual(new Set(STYLE_PRESETS.map(style=>style.id)));
  });
  it("keeps existing style identifiers and carries the preview tokens to generation", () => {
    for (const preset of STYLE_PRESETS) {
      expect(UI_STYLE_OPTIONS.some((option) => option.value === preset.id)).toBe(true);
      const context = presetDesignContext(preset.id);
      expect(context).toContain(preset.id);
      expect(context).toContain(".easymint/design/visual-spec.json");
      const visual=createVisualSpec({styleId:preset.id});
      const snapshot=presetFromVisualSpec(visual);
      const preview=resolveStylePreset(preset,visual.selection);
      expect(snapshot.recipes).toEqual(preview.recipes);
      expect(snapshot.artwork).toEqual(preview.artwork);
    }
    expect(presetDesignContext("")).toContain("minimalism; palette");
    expect(presetDesignContext("User-defined style")).toContain("User visual brief: User-defined style");
  });
});

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("independent style palettes", () => {
  it("hands off each style's layout and artwork together with its component recipes", () => {
    for (const preset of STYLE_PRESETS) {
      const context = presetDesignContext(preset.id);
      const spec = createVisualSpec({ styleId: preset.id });
      expect(spec.material.layout).toEqual(preset.layout);
      expect(spec.material.artwork).toEqual(preset.artwork);
      expect(presetFromVisualSpec(spec).recipes).toEqual(resolveStylePreset(preset,spec.selection).recipes);
      expect(context).toContain("components.css");
      expect(context).not.toContain(JSON.stringify(preset.recipes));
      expect(preset.colors.accent).toBe(preset.accent);
    }
  });

  it("marks brief-driven choices without presenting the neutral base as the selected style", () => {
    for (const choice of ["", "custom", "unrecognized-style"]) {
      const context = presetDesignContext(choice);
      expect(context).toContain("minimalism; palette");
      expect(context).toContain("showcase-mobile.html");
      if (!choice) {
        expect(context).toContain("Reuse this actual composition");
        expect(context).not.toContain("brief-driven project");
      } else if (choice === "custom") {
        expect(context).toContain("without a description");
        expect(context).not.toContain("Reuse this actual composition");
      } else {
        expect(context).toContain("brief-driven project");
        expect(context).toContain(`User visual brief: ${choice}`);
        expect(context).not.toContain("Reuse this actual composition");
      }
      expect(context).not.toContain("Web layout:");
    }
  });

  it("pairs active solid-surface labels with at least 4.5:1 contrast", () => {
    for (const preset of STYLE_PRESETS) {
      expect(contrast(preset.ink, preset.background), preset.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(preset.muted, preset.background), preset.id).toBeGreaterThanOrEqual(4.5);
      expect(contrast(preset.colors.onWarning, preset.colors.warning), preset.id).toBeGreaterThanOrEqual(4.5);
      for (const recipe of Object.values(preset.recipes)) {
        if (/^#[a-f0-9]{6}$/i.test(recipe.background)) expect(contrast(recipe.color, recipe.background), preset.id).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("retains flat geometry and tactile material differences", () => {
    const flat = STYLE_PRESETS.find((preset) => preset.id === "flat")!;
    expect(flat.radius).toBe(0);
    for (const recipe of Object.values(flat.recipes)) {
      expect(recipe.shadow).toBe("none");
      expect(recipe.background).not.toContain("gradient");
    }
    const relief = STYLE_PRESETS.find((preset) => preset.id === "neumorphism")!;
    expect(relief.recipes.input.shadow).toContain("inset");
    expect(relief.recipes.primary.shadow).not.toContain("inset");
    const tactile = STYLE_PRESETS.find((preset) => preset.id === "skeuomorphism")!;
    expect(tactile.recipes.primary.background).toContain("linear-gradient");
    expect(tactile.rules).toContain("black fine-grain soft-touch");
  });
});


describe("appearance recovery and handoff", () => {
  it("restores appearance independently of demo state and defaults old or malformed drafts", () => {
    const valid = parseProjectDraft(JSON.stringify({ data: { name: "Demo", dir: "/projects", uiPalette: "coral", uiEffect: "subtle", demo: { password: "private" } }, step: 2 }));
    expect(valid?.data.uiPalette).toBe("coral");
    expect(valid?.data.uiEffect).toBe("subtle");
    expect(valid?.data).not.toHaveProperty("demo");
    const old = parseProjectDraft(JSON.stringify({ data: { uiPalette: "brown", uiEffect: false } }));
    expect(old?.data.uiPalette).toBe("default");
    expect(old?.data.uiEffect).toBe("standard");
  });
  it("resolves explicit colors without mutating another style or flattening material rules", () => {
    const flat = STYLE_PRESETS.find((preset) => preset.id === "flat")!;
    const before = JSON.stringify(flat);
    const resolved = resolveStylePreset(flat, { palette: "green", effect: "subtle" });
    expect(resolved.accent).toBe("#23634d");
    expect(resolved.radius).toBe(0);
    for (const recipe of Object.values(resolved.recipes)) {
      expect(recipe.shadow).toBe("none");
      expect(recipe.background).not.toContain("gradient");
    }
    expect(JSON.stringify(flat)).toBe(before);
    for (const style of ["", "flat", "custom"]) {
      const context = presetDesignContext(style, { palette: "green", effect: "subtle" });
      expect(context).toContain("palette green; effect subtle");
      expect(createVisualSpec({ styleId: style, palette: "green", effect: "subtle" }).semantic.accent).toBe("#23634d");
    }
  });
  it("keeps solid action and menu labels readable across all palette/effect combinations", () => {
    for (const style of STYLE_PRESETS) for (const palette of ["default", "mono", "coral", "green", "violet"] as const) for (const effect of ["standard", "subtle"] as const) {
      const resolved = resolveStylePreset(style, { palette, effect });
      for (const recipe of Object.values(resolved.recipes)) {
        if (resolved.id === "flat") { expect(recipe.shadow).toBe("none"); expect(recipe.background).not.toContain("gradient"); }
        if (/^#[a-f0-9]{6}$/i.test(recipe.background)) expect(contrast(recipe.color, recipe.background), `${style.id}/${palette}/${effect}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

it("defaults empty legacy style choices and preserves all selected mobile platforms", () => {
  const result = parseProjectDraft(JSON.stringify({ step: 2, data: { ...DEFAULT_DATA, name: "Mobile", uiStyle: "", targets: ["ios-mobile", "android-mobile", "harmony-mobile"] } }));
  expect(result?.data.uiStyle).toBe("minimalism");
  expect(result?.data.targets).toEqual(["ios-mobile", "android-mobile", "harmony-mobile"]);
  expect(result?.step).toBe(2);
});

it("gives empty older drafts three feature slots without changing authored features", () => {
  const blank = parseProjectDraft(JSON.stringify({ data: { ...DEFAULT_DATA, name: "Restored" }, step: 1 }));
  expect(blank?.data.features).toEqual([{ name: "" }, { name: "" }, { name: "" }]);
  const authored = parseProjectDraft(JSON.stringify({ data: { ...DEFAULT_DATA, name: "Restored", features: [{ name: "Keep exactly" }] }, step: 1 }));
  expect(authored?.data.features).toEqual([{ name: "Keep exactly" }]);
});
