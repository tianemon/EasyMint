import zh from '../i18n/zh-CN.json';

const dict = zh as Record<string, string>;

/** 文案真值源：桌面端 app/shared/i18n/locales/zh-CN.json（构建时提取）。 */
export function t(key: string, vars?: Record<string, string | number>): string {
  let value = dict[key] ?? key;
  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{{${name}}}`, String(replacement));
    }
  }
  return value;
}
