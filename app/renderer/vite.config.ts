import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: __dirname,
  base: "./",
  publicDir: path.resolve(__dirname, "..", "..", "assets"),
  build: {
    outDir: "dist",
    emptyOutDir: true,
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
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "..", "shared"),
    },
  },
  build: {
    chunkSizeWarningLimit: 10000, // Electron 本地加载，无需像网页那样限制 chunk 大小
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: {
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self' ws://localhost:5173 https:; img-src 'self' data: blob: https:; font-src 'self' data:;",
    },
  },
});
