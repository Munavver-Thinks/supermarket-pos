import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import renderer from "vite-plugin-electron-renderer";

const fromRoot = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * The same aliases as tsconfig.json `paths`. The Electron main and preload builds get their own
 * Vite config from vite-plugin-electron, so they are passed the aliases explicitly as well.
 * Output format: this package.json has no "type" field, so the plugin builds main and preload as
 * CommonJS, which the sandboxed preload needs.
 */
const alias = {
  "@pos/business-logic": fromRoot("./src/core/business-logic/index.ts"),
  "@pos/database": fromRoot("./src/core/database/index.ts"),
  "@pos/types": fromRoot("./src/core/types/index.ts"),
  "@pos/validation": fromRoot("./src/core/validation/index.ts"),
  "@shared": fromRoot("./electron/shared"),
  "@": fromRoot("./src"),
};

export default defineConfig({
  resolve: { alias },
  plugins: [
    react(),
    electron({
      main: {
        entry: "electron/main/index.ts",
        vite: {
          resolve: { alias },
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
          resolve: { alias },
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
