import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./apps/pos-desktop/electron/shared", import.meta.url)),
      "@": fileURLToPath(new URL("./apps/pos-desktop/src", import.meta.url)),
    },
  },
  test: {
    // Main-process tests must not import electron: they run in plain Node. Renderer tests
    // (src/**) get a DOM.
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/pos-desktop/electron/**/*.test.ts",
      "apps/pos-desktop/src/**/*.test.{ts,tsx}",
    ],
    environmentMatchGlobs: [["apps/pos-desktop/src/**", "jsdom"]],
    testTimeout: 15000,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
