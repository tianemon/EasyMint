import type { PairingOffer } from './types';

/**
 * 二维码 payload 解析（纯模块，不引用 DOM / React，可直接放进 Worker）。
 * 二维码 URL：http://<LAN-IP>:<HTTP端口>/#pair=<payload>，
 * payload 与现有 easymint://pair?payload= 完全同形（base64url(JSON)）。
 */

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** 从 location.hash 形态的字符串里取出 #pair= 的 payload；不匹配返回 null。 */
export function pairPayloadFromHash(hash: string): string | null {
  const match = /^#pair=([^&\s]+)$/.exec(hash.trim());
  return match ? match[1] : null;
}

export function parsePairingPayload(payload: string): PairingOffer {
  let decoded: string;
  try {
    decoded = decodeBase64Url(decodeURIComponent(payload));
  } catch {
    throw new Error('配对二维码内容不完整');
  }
  const offer = JSON.parse(decoded) as Partial<PairingOffer>;
  if (
    offer.version !== 1 || !offer.token || !offer.pcId || !offer.pcName ||
    !Array.isArray(offer.addresses) || !offer.addresses.every((item) => typeof item === 'string') ||
    !Number.isInteger(offer.port) || !offer.publicKey || !Number.isFinite(offer.expiresAt)
  ) throw new Error('配对二维码内容不完整');
  if ((offer.expiresAt ?? 0) <= Date.now()) throw new Error('配对二维码已过期，请在电脑上重新生成');
  if (offer.addresses.length === 0) throw new Error('电脑没有可用的局域网地址');
  return offer as PairingOffer;
}
