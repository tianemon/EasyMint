/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 从桌面端 package.json 注入 */
declare const __EM_VERSION__: string;

declare module 'base64-js' {
  export function fromByteArray(bytes: Uint8Array): string;
  export function toByteArray(value: string): Uint8Array;
  export function byteLength(value: string): number;
}
