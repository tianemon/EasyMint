/**
 * API Key 掩码 / 哨兵约定（settings:get 掩码 + 渲染层「不修改」回传标记）。
 * 主进程 settings:get 用 maskApiKey 掩码后回传；渲染层提交时若 key 未改动，
 * 用 API_KEY_UNCHANGED 哨兵表示「保留原 key」，主进程据此还原已加密存储的 key。
 */

/** 渲染层回传掩码 key 时的「不修改」哨兵值——主进程收到后保留原 key 不覆盖 */
export const API_KEY_UNCHANGED = "__easymint_keep_existing_api_key__";

/** 明文 key → 掩码显示（sk-****<后4位>；短 key 全掩）。掩码不可逆，仅供展示与「未改动」比对 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  const dash = key.indexOf("-");
  const head = dash > 0 && dash <= 5 ? key.slice(0, dash + 1) : key.slice(0, 3);
  return `${head}****${key.slice(-4)}`;
}

/** 值是否为掩码形态（主进程防御性还原用） */
export function isMaskedApiKey(value: string): boolean {
  return /^\S{2,5}\*{4}\S{4}$/.test(value) && !value.includes("__easymint_");
}

/**
 * em-settings 旧版 apiKeys 映射中不带密钥语义的条目（VISION_* 配置项）——
 * 掩码/加密都要跳过：它们不是密钥，掩码后 UI 无法显示、加密后读侧也要跟着解密。
 */
const LEGACY_CONFIG_ENTRIES = new Set(["VISION_MODE", "VISION_BASE_URL", "VISION_MODEL"]);

/** apiKeys 映射条目是否应视为真密钥（非 VISION_* 配置项一律按密钥处理：掩码显示、加密落盘） */
export function isSecretLegacyEntry(name: string): boolean {
  return !LEGACY_CONFIG_ENTRIES.has(name);
}
