/**
 * em-settings 落盘密钥加解密（safeStorage——系统钥匙串/DPAPI，主进程专用）。
 *
 * 多路读取方共用同一套规则（1.4 透明加密）：
 *  - Store（settings:get/save 主路径）：写前加密、读后解密；
 *  - api-clients / mcp-service（直接读 em-settings.json 的旁路读取方）：
 *    读后同样解密，否则 vision/webFetch/MCP env 拿到的是密文。
 * 解密不可逆失败（换机/凭据被清）→ 返回空串并提示用户重新填写，不抛异常。
 * 非 Electron 环境（vitest / 独立 node 进程）safeStorage 不可用 → 原样返回，
 * 保证只读模块在无主进程上下文中不崩、明文兼容期不误伤。
 */

import { safeStorage } from "electron";
import type { ProviderConfig, ApiProvidersData } from "../../shared/platform-presets";
import { isSecretLegacyEntry } from "../../shared/secrets";

/** 加密值前缀（识别已加密条目；无前缀 = 旧版明文，读取时原样返回） */
const ENC_PREFIX = "em-v1:";

function encryptionReady(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/** 加密单条 key；系统加密不可用（钥匙串锁定/非 GUI 环境）→ 回退明文落盘并告警 */
export function encryptApiKeyValue(plain: string): string {
  if (!plain || plain.startsWith(ENC_PREFIX)) return plain;
  if (!encryptionReady()) {
    console.warn("[settings-crypto] 系统加密不可用（safeStorage），API Key 将以明文落盘——请解锁系统钥匙串后重试保存");
    return plain;
  }
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString("base64");
  } catch (e) {
    console.warn("[settings-crypto] API Key 加密失败，回退明文：", (e as Error).message);
    return plain;
  }
}

/** 解密单条 key；解密失败（换机/凭据被清）→ 返回空串并提示用户重新填写 */
export function decryptApiKeyValue(stored: string): string {
  if (!stored) return stored;
  if (!stored.startsWith(ENC_PREFIX)) return stored; // 旧版明文（兼容读取）
  if (!encryptionReady()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), "base64"));
  } catch (e) {
    console.warn("[settings-crypto] API Key 解密失败（钥匙串不可用或凭据被清除），请在设置页重新填写：", (e as Error).message);
    return "";
  }
}

/** 旧版 apiKeys 映射落盘加密——只加密密钥语义条目，VISION_* 配置项原样保留 */
export function encryptLegacyApiKeys(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return map;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = isSecretLegacyEntry(k) ? encryptApiKeyValue(v) : v;
  }
  return out;
}

/** 旧版 apiKeys 映射读取解密——密钥条目解密；配置项若意外被加密（防御）也一并还原 */
export function decryptLegacyApiKeys(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return map;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = isSecretLegacyEntry(k) ? decryptApiKeyValue(v) : v.startsWith(ENC_PREFIX) ? decryptApiKeyValue(v) : v;
  }
  return out;
}

/** apiProviders 整体加密（逐条 apiKey 处理，不改其他字段） */
export function encryptProviders(p: ApiProvidersData | undefined): ApiProvidersData | undefined {
  if (!p) return p;
  return {
    current: p.current,
    configs: Object.fromEntries(
      Object.entries(p.configs ?? {}).map(([id, cfg]: [string, ProviderConfig]) => [id, { ...cfg, apiKey: encryptApiKeyValue(cfg.apiKey ?? "") }]),
    ),
  };
}

/** apiProviders 整体解密（逐条 apiKey 处理，不改其他字段） */
export function decryptProviders(p: ApiProvidersData | undefined): ApiProvidersData | undefined {
  if (!p) return p;
  return {
    current: p.current,
    configs: Object.fromEntries(
      Object.entries(p.configs ?? {}).map(([id, cfg]: [string, ProviderConfig]) => [id, { ...cfg, apiKey: decryptApiKeyValue(cfg.apiKey ?? "") }]),
    ),
  };
}
