import type { PairingOffer } from './types';

/**
 * 二维码配对（纯模块，不引用 DOM / React，可直接放进 Worker）。
 * 二维码 URL：http://<host>:<HTTP端口>/#p=<code>，code 为 10 位 [A-Za-z0-9_-]。
 * 桌面端提供 GET /pair/<code>.json → 200 {version:1, token, pcId, ...}（与旧 #pair= 解码后同形）；
 * 未命中/过期 → 404 空体。短码不含密钥材料，可保留在地址栏供刷新后重试。
 */

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 从 location.hash 解析 10 位短码（/^#p=([A-Za-z0-9_-]{10})$/）；不匹配返回 null。 */
export function pairCodeFromHash(hash: string): string | null {
  const match = /^#p=([A-Za-z0-9_-]{10})$/.exec(hash.trim());
  return match ? match[1] : null;
}

/**
 * 从「整条配对链接」或「裸短码」里取出 10 位短码；取不到返回 null。
 * 手动输入与网页内扫码两条恢复路径共用同一套判定。
 */
export function extractPairCode(input: string): string | null {
  const text = input.trim();
  const fromHash = /[#?]p=([A-Za-z0-9]{10})/.exec(text);
  if (fromHash) return fromHash[1].toUpperCase();
  // 电脑端把码显示成 5-5 分组（ABCDE-FGHIJ），手输/粘贴带横杠也要认；
  // 统一去掉非字母数字再判断，服务端 lookup 同样会 toUpperCase。
  const compact = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return /^[A-Z0-9]{10}$/.test(compact) ? compact : null;
}

/** 字段校验（version/token/pcId/pcName/addresses/port/publicKey/expiresAt + 过期 + 空地址），错误文案沿用现有中文。 */
export function parsePairingObject(value: unknown): PairingOffer {
  if (typeof value !== 'object' || value === null) throw new Error('配对二维码内容不完整');
  const offer = value as Partial<PairingOffer>;
  if (
    offer.version !== 1 || !offer.token || !offer.pcId || !offer.pcName ||
    !Array.isArray(offer.addresses) || !offer.addresses.every((item) => typeof item === 'string') ||
    !Number.isInteger(offer.port) || !offer.publicKey || !Number.isFinite(offer.expiresAt)
  ) throw new Error('配对二维码内容不完整');
  if ((offer.expiresAt ?? 0) <= Date.now()) throw new Error('配对二维码已过期，请在电脑上重新生成');
  if (offer.addresses.length === 0) throw new Error('电脑没有可用的局域网地址');
  return offer as PairingOffer;
}

/** 保留兼容：旧 #pair=<base64url(JSON)> 长载荷解析，供既有测试/兼容。 */
export function parsePairingPayload(payload: string): PairingOffer {
  let decoded: string;
  try {
    decoded = decodeBase64Url(decodeURIComponent(payload));
  } catch {
    throw new Error('配对二维码内容不完整');
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    throw new Error('配对二维码内容不完整');
  }
  return parsePairingObject(value);
}

/** 短码查表：同源相对路径 GET ./pair/<code>.json，成功后按对象校验。 */
export async function fetchPairingPayload(code: string): Promise<PairingOffer> {
  let response: Response;
  try {
    response = await fetch(`./pair/${code}.json`, { cache: 'no-store' });
  } catch {
    throw new Error('二维码已过期，请在电脑上重新生成');
  }
  if (!response.ok) throw new Error('二维码已过期，请在电脑上重新生成');
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error('配对二维码内容不完整');
  }
  return parsePairingObject(value);
}
