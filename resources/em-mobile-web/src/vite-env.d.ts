/// <reference types="vite/client" />

declare module 'base64-js' {
  export function fromByteArray(bytes: Uint8Array): string;
  export function toByteArray(value: string): Uint8Array;
  export function byteLength(value: string): number;
}
