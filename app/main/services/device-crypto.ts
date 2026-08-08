/**
 * 设备互联加密工具 — ECDH 密钥交换 + AES-256-GCM 传输加密
 *
 * 方案(用户确认):基础防嗅探——
 * ① 配对: 双方 ECDH 交换公钥,各自派生共享密钥(密钥永不传输)
 * ② 认证: hello 携带 AES-GCM 加密的 challenge,解密成功 = 持有密钥
 * ③ 传输: 迁移数据用共享密钥 AES-256-GCM 加密
 * 心跳/控制消息明文(无敏感数据)
 */

import * as crypto from "node:crypto";

const CURVE = "prime256v1";
const ALGO = "aes-256-gcm";

/** 生成 ECDH 密钥对,返回 { privateKey, publicKey(base64) } */
export function generateKeyPair(): { privateKey: crypto.ECDH; publicKey: string } {
  const ecdh = crypto.createECDH(CURVE);
  ecdh.generateKeys();
  return { privateKey: ecdh, publicKey: ecdh.getPublicKey().toString("base64") };
}

/** 用对方公钥派生共享密钥(双方各自算,结果一致,密钥不传输) */
export function deriveSharedKey(privateKey: crypto.ECDH, peerPublicKeyB64: string): Buffer {
  return privateKey.computeSecret(Buffer.from(peerPublicKeyB64, "base64"));
}

/** AES-256-GCM 加密 → { iv, tag, data }(均 base64) */
export function encrypt(sharedKey: Buffer, plaintext: string): { iv: string; tag: string; data: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, sharedKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: enc.toString("base64"),
  };
}

/** AES-256-GCM 解密。失败返回 null(密钥不符/数据被篡改) */
export function decrypt(sharedKey: Buffer, enc: { iv: string; tag: string; data: string }): string | null {
  try {
    const iv = Buffer.from(enc.iv, "base64");
    const tag = Buffer.from(enc.tag, "base64");
    const data = Buffer.from(enc.data, "base64");
    const decipher = crypto.createDecipheriv(ALGO, sharedKey, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return null;
  }
}

/** 生成认证 challenge:共享密钥加密的随机串 */
export function makeChallenge(sharedKey: Buffer): { iv: string; tag: string; data: string } {
  return encrypt(sharedKey, crypto.randomBytes(16).toString("hex"));
}
