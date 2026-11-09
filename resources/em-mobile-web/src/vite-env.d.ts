/// <reference types="vite/client" />

/** 构建时由 vite.config.ts 从桌面端 package.json 注入 */
declare const __EM_VERSION__: string;

/** 构建标记（yyyy-MM-dd HH:mm）：手机端「设置 → 关于」显示，用来确认手机加载的是哪一次构建 */
declare const __EM_BUILD__: string;

declare module 'base64-js' {
  export function fromByteArray(bytes: Uint8Array): string;
  export function toByteArray(value: string): Uint8Array;
  export function byteLength(value: string): number;
}
