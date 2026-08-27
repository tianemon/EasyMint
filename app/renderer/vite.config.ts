import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import monacoEditorPlugin from "@dvaji/vite-plugin-monaco-editor";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss(), monacoEditorPlugin({})],
  root: import.meta.dirname,
  base: "./",
  publicDir: path.resolve(import.meta.dirname, "..", "..", "assets"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 10000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("monaco")) return "monaco";
        },
      },
    },
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
    headers: {
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self' ws://localhost:5173 https:; img-src 'self' data: blob: https:; font-src 'self' data:;",
    },
  },
});
