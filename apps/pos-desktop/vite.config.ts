import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import renderer from "vite-plugin-electron-renderer";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./electron/shared", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/main",
            rollupOptions: {
              // Only native/binary or Electron-runtime-coupled packages stay external — everything
              // else (pure JS, e.g. bcryptjs) gets bundled so Node's ESM loader never has to
              // statically import a CJS package directly (a known Node/cjs-module-lexer trip-up
              // with some CJS package shapes). better-sqlite3 is loaded via createRequire instead
              // of a static import specifically to dodge that same issue for a native addon.
              external: ["better-sqlite3", "electron", "electron-updater"],
            },
          },
        },
      },
      preload: {
        input: "electron/preload/index.ts",
        vite: {
          build: {
            outDir: "dist-electron/preload",
          },
        },
      },
      renderer: {},
    }),
    renderer(),
  ],
  build: {
    outDir: "dist",
  },
});
