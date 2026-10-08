import type { i18n } from "i18next";
import zh from "./locales/zh-CN.json";
import en from "./locales/en.json";

const entries = [...Object.entries(zh), ...Object.entries(en)];
const baseKey = (key: string) => key.replace(/_(?:one|other)$/, "");
const sourceKeys = new Map(entries.filter(([, value]) => !value.includes("{{")).map(([key, value]) => [value, baseKey(key)]));
const templates = entries.filter(([, value]) => value.includes("{{")).map(([key, value]) => {
  const names: string[] = [];
  const pieces = value.split(/({{\w+}})/g).map((piece) => {
    const name = /^{{(\w+)}}$/.exec(piece)?.[1];
    if (name) { names.push(name); return "([\\s\\S]*?)"; }
    return piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return { key: baseKey(key), names, specificity: value.replace(/{{\w+}}/g, "").length, pattern: new RegExp(`^${pieces.join("")}$`) };
}).sort((a, b) => b.specificity - a.specificity);

// Only application-owned labels/errors use this compatibility adapter. Conversation
// bodies, file contents, custom names, and third-party tool output bypass it.
export function translateAppText(instance: i18n, value: string): string {
  const key = sourceKeys.get(value);
  if (key) return instance.t(key);
  if (value.length > 10_000) return value;
  for (const template of templates) {
    const match = template.pattern.exec(value);
    if (!match) continue;
    const parameters: Record<string, string> = {};
    template.names.forEach((name, index) => { parameters[name] = match[index + 1]!; });
    const count = Number(parameters.count ?? parameters.v0);
    return instance.t(template.key, {
      ...parameters,
      ...(Number.isFinite(count) && instance.exists(`${template.key}_one`) ? { count } : {}),
    });
  }
  return value;
}
