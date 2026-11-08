/**
 * 非安全上下文（http://<LAN-IP>:port）唯一可用的 Crypto 成员是 getRandomValues。
 * 这里替换 expo-crypto 的 getRandomBytes / randomUUID：接口保持一致，
 * 以便 security/crypto.ts 的加密字节与桌面端 remote-crypto.ts 完全一致。
 */
function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export function getRandomBytes(length: number): Uint8Array {
  return randomBytes(length);
}

/** crypto.randomUUID 在非安全上下文不可用，按 RFC 4122 v4 从 getRandomValues 构造。 */
export function randomUUID(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
