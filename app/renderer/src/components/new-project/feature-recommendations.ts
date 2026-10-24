import type { FeatureItem } from "./ProjectFormTypes";

export function emptyFeatureRows(count = 3): FeatureItem[] {
  return Array.from({ length: count }, () => ({ name: "" }));
}

/** Merge against the latest form state, including edits made while the request was running. */
export function applyFeatureRecommendations(current: readonly FeatureItem[], recommended: readonly FeatureItem[]): FeatureItem[] {
  const authored = current.filter(feature => feature.name.trim());
  const seen = new Set(authored.map(feature => feature.name.trim().toLocaleLowerCase()));
  const additions: FeatureItem[] = [];
  for (const feature of recommended) {
    const name = feature.name.trim(), identity = name.toLocaleLowerCase();
    if (!name || seen.has(identity)) continue;
    seen.add(identity);
    additions.push({ name });
  }
  if (authored.length) return [...authored, ...additions];
  // Fill the existing blank slots first; keep three editable rows for a short recommendation.
  return [...additions, ...emptyFeatureRows(Math.max(0, Math.max(3, current.length) - additions.length))];
}
