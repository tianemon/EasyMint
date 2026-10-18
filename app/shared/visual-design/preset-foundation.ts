export interface ComponentRecipe {
  background: string;
  color: string;
  border: string;
  radius: string;
  shadow: string;
}

export interface StyleDefinition {
  tone?: "light" | "dark";
  blur?: number;
  scales?: { fontSize: Record<string, number>; spacing: Record<string, number> };
  id: string;
  label: string;
  description: string;
  summary: string;
  colors: StyleColorRoles;
  artwork: { color: string; soft: string; ink: string };
  layout: { web: string; mobile: string };
  background: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  border: string;
  radius: number;
  font: string;
  density: string;
  sidebar: string;
  texture: string;
  recipes: Record<"card" | "primary" | "secondary" | "input" | "menu", ComponentRecipe>;
  states: { hover: string; pressed: string; focus: string; disabled: string; error: string };
  rules: string;
}

export interface StyleColorRoles {
  accent: string;
  accentSoft: string;
  onAccentSoft: string;
  focus: string;
  success: string;
  danger: string;
  warning: string;
  onWarning: string;
}

export const LIGHT_STYLE_COLORS: StyleColorRoles = {
  accent: "#262626", accentSoft: "#EFEFEF", onAccentSoft: "#171717", focus: "#2563EB",
  success: "#166534", danger: "#B91C1C", warning: "#FACC15", onWarning: "#171717",
};
export const DARK_STYLE_COLORS: StyleColorRoles = {
  accent: "#F5F5F5", accentSoft: "#FFFFFF14", onAccentSoft: "#FFFFFF", focus: "#93C5FD",
  success: "#86EFAC", danger: "#FECACA", warning: "#FDE047", onWarning: "#171717",
};


export const recipe = (background: string, color: string, border: string, radius: number, shadow = "none"): ComponentRecipe => ({ background, color, border, radius: `${radius}px`, shadow });
