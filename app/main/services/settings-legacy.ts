/**
 * 「1.4 API Key safeStorage 加密落盘」回退后的旧数据兼容（2026-09-09 回退）。
 *
 * 1.4 曾把 apiKeys / apiProviders[].apiKey 用 Electron safeStorage 加密后写入
 * em-settings.json（em-v1: 前缀密文）。回退后恢复明文读写，但磁盘上仍可能残留
 * 该前缀的旧密文——密文不可逆解密，读取方统一把这类值降级为「未配置」：
 * 旧版 apiKeys 条目整条丢弃、apiProviders 配置的 apiKey 置空（其余字段保留），
 * 由用户在设置页重新填写。绝不让 em-v1:... 密文被当作真实 key 使用或抛出异常。
 */

import type { ProviderConfig, ApiProvidersData } from "../../shared/platform-presets";

/** 1.4 加密落盘期的密文前缀（em-v1:<base64>）；命中 = 已无法解密的旧密文 */
const LEGACY_ENC_PREFIX = "em-v1:";

function isLegacyEncryptedValue(value: string | undefined): boolean {
  return !!value && value.startsWith(LEGACY_ENC_PREFIX);
}

/** 旧版 apiKeys 映射：丢弃密文条目（密钥条目可能被加密过；VISION_* 等配置项本就是明文，原样保留） */
export function dropLegacyEncryptedApiKeys(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return map;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!isLegacyEncryptedValue(v)) out[k] = v;
  }
  return Object.keys(out).length === Object.keys(map).length ? map : out;
}

/** apiProviders：密文 apiKey 置空（配置其余字段保留），提示用户在设置页重新填写 */
export function dropLegacyEncryptedProviderKeys(p: ApiProvidersData | undefined): ApiProvidersData | undefined {
  if (!p || !p.configs) return p;
  let changed = false;
  const configs: Record<string, ProviderConfig> = {};
  for (const [id, cfg] of Object.entries(p.configs)) {
    if (isLegacyEncryptedValue(cfg.apiKey)) {
      configs[id] = { ...cfg, apiKey: "" };
      changed = true;
    } else {
      configs[id] = cfg;
    }
  }
  return changed ? { current: p.current, configs } : p;
}
