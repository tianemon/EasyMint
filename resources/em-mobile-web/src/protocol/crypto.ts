import { gcm } from '@noble/ciphers/aes.js';
import { p256 } from '@noble/curves/nist.js';
import { hmac } from '@noble/hashes/hmac.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { fromByteArray, toByteArray } from 'base64-js';
import * as Crypto from './web-random';

export interface SessionKeys {
  auth: Uint8Array;
  clientToServer: Uint8Array;
  serverToClient: Uint8Array;
}

const SALT = utf8ToBytes('easymint-remote-terminal-v1');

export function randomId(): string {
  return Crypto.randomUUID();
}

export function createPairingKeyPair(): { secretKey: Uint8Array; publicKey: string } {
  const secretKey = p256.utils.randomSecretKey(Crypto.getRandomBytes(48));
  return { secretKey, publicKey: fromByteArray(p256.getPublicKey(secretKey, false)) };
}

export function computeSharedSecret(secretKey: Uint8Array, pcPublicKey: string): Uint8Array {
  const point = p256.getSharedSecret(secretKey, toByteArray(pcPublicKey), false);
  return point.slice(1, 33);
}

export function deriveKeys(sharedSecret: Uint8Array): SessionKeys {
  const derive = (info: string) => hkdf(sha256, sharedSecret, SALT, utf8ToBytes(info), 32);
  return {
    auth: derive('authentication'),
    clientToServer: derive('client-to-server'),
    serverToClient: derive('server-to-client'),
  };
}

export function proof(key: Uint8Array, value: string): string {
  return fromByteArray(hmac(sha256, key, utf8ToBytes(value)));
}

export function pairingCode(key: Uint8Array, token: string): string {
  const digest = hmac(sha256, key, utf8ToBytes(`pair:${token}`));
  const value = (((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0) % 1_000_000;
  return String(value).padStart(6, '0');
}

function aad(direction: 'c2s' | 's2c', connectionId: string, sequence: number): Uint8Array {
  return utf8ToBytes(`1:${direction}:${connectionId}:${sequence}`);
}

export function encrypt(
  key: Uint8Array,
  connectionId: string,
  sequence: number,
  plaintext: string,
): { sequence: number; iv: string; tag: string; data: string } {
  const iv = Crypto.getRandomBytes(12);
  const encrypted = gcm(key, iv, aad('c2s', connectionId, sequence)).encrypt(utf8ToBytes(plaintext));
  return {
    sequence,
    iv: fromByteArray(iv),
    data: fromByteArray(encrypted.slice(0, -16)),
    tag: fromByteArray(encrypted.slice(-16)),
  };
}

export function decrypt(
  key: Uint8Array,
  connectionId: string,
  sequence: number,
  message: { iv: string; tag: string; data: string },
): string {
  const ciphertext = toByteArray(message.data);
  const tag = toByteArray(message.tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  const plain = gcm(key, toByteArray(message.iv), aad('s2c', connectionId, sequence)).decrypt(combined);
  return new TextDecoder().decode(plain);
}

export const base64 = {
  encode: (bytes: Uint8Array) => fromByteArray(bytes),
  decode: (value: string) => toByteArray(value),
};
