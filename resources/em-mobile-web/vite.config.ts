import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const vendorNoble = fileURLToPath(new URL('./vendor/@noble', import.meta.url));

// 网络不可用时 @noble/ciphers / @noble/curves 从手机 App 仓库 vendor 到本项目，
// 用 alias 指向本地副本（版本锁 2.4.0，与桌面端 remote-crypto 字节级一致）。
const useVendor = existsSync(`${vendorNoble}/ciphers`) && existsSync(`${vendorNoble}/curves`);
const alias: Record<string, string> = useVendor
  ? {
      '@noble/ciphers': `${vendorNoble}/ciphers`,
      '@noble/curves': `${vendorNoble}/curves`,
      '@noble/hashes': `${vendorNoble}/hashes`,
    }
  : {};

export default defineConfig({
  base: './',
  // 产物全部落到 dist/，桌面端 extraResources 直接映射该目录（契约 C1）。
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // CSP script-src 'self'：禁止 Vite 注入 modulepreload polyfill 内联脚本（契约 C2）。
    modulePreload: { polyfill: false },
    target: 'es2022',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  worker: { format: 'es' },
  resolve: { alias },
  server: { host: true },
  // 便于静态托管校验：dev 时 index.html 也用相对入口。
  root: here,
});
