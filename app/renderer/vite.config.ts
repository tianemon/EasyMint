import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import monacoEditorPlugin from "@dvaji/vite-plugin-monaco-editor";
import path from "path";
import { createHash } from "node:crypto";

/** 收集 html 内联 <script> 的 sha256（外链 src= 脚本跳过）——CSP script-src 用 hash 精确放行 */
function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    const body = m[2] ?? "";
    if (!body.trim()) continue;
    hashes.push(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
  return hashes;
}

/**
 * CSP script-src 按环境注入（index.html 的 %EM_CSP_SCRIPT_SRC% 占位）：
 * - 生产构建(打包产物,file:// 加载)→ 'self' + 内联脚本 sha256 hash（无 unsafe-inline——1.1 要求）。
 *   monaco 插件的 MonacoEnvironment 是内联脚本：不能删（编辑器 worker 依赖），改用 hash 精确放行，
 *   AI 输出/项目文件注入的任意 <script> 仍被拦。order: 'post' 保证在 monaco 等插件注入后才取 hash。
 * - dev server → 'self' 'unsafe-inline'（@vitejs/plugin-react 的 HMR preamble 是内联脚本，
 *   严格 CSP 会让开发模式无法热更新；dev 只在本机 localhost 可访问,风险面在打包产物,两者分开）
 */
function emCspPlugin(mode: string): Plugin {
  return {
    name: "em-csp-script-src",
    transformIndexHtml: {
      order: "post",
      handler(html: string) {
        const isDev = mode === "development";
        const scriptSrc = isDev
          ? "'self' 'unsafe-inline'"
          : ["'self'", ...inlineScriptHashes(html)].join(" ");
        return html.replace("%EM_CSP_SCRIPT_SRC%", scriptSrc);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), monacoEditorPlugin({}), emCspPlugin(mode)],
  root: import.meta.dirname,
  base: "./",
  publicDir: path.resolve(import.meta.dirname, "..", "..", "assets"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 10000,
    // 不做 manualChunks。原先按 "monaco" 子串分组，实际把 @monaco-editor/react 及其依赖
    // （React 本体、Vite 的 preload 辅助）一起卷进那个 4.4MB 的 chunk，入口为了拿 React 静态
    // import 它 → index.html 依然 modulepreload monaco，懒加载等于没做。
    // 现在 monaco 只被动态 import，让打包器按引用关系自动切分即可。
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@shared": path.resolve(import.meta.dirname, "..", "shared"),
    },
  },
  logLevel: "warn",
  server: {
    port: 5173,
    strictPort: true,
  },
}));
