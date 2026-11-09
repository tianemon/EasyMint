import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const vendorNoble = fileURLToPath(new URL('./vendor/@noble', import.meta.url));
// 版本号取桌面端 package.json（App 设置页「关于」显示 expo.version，Web 对齐同一发布版本）
const desktopVersion = (JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version?: string }).version ?? '0.0.0';

/** 构建标记：手机端「设置 → 关于」直接读它，用来确认手机跑的是哪一次构建（排除缓存/旧包）。 */
const buildStamp = (() => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
    + `${pad(now.getHours())}:${pad(now.getMinutes())}`;
})();

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
  define: { __EM_VERSION__: JSON.stringify(desktopVersion), __EM_BUILD__: JSON.stringify(buildStamp) },
  // 产物全部落到 dist/，桌面端 extraResources 直接映射该目录（契约 C1）。
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // CSP script-src 'self'：禁止 Vite 注入 modulepreload polyfill 内联脚本（契约 C2）。
    modulePreload: { polyfill: false },
    target: 'es2022',
    cssTarget: ['chrome76', 'safari15'],
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
