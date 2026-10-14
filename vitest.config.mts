import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Same aliases as tsconfig.json `paths` and vite.config.mts.
    alias: {
      "@pos/business-logic": fromRoot("./src/core/business-logic/index.ts"),
      "@pos/database": fromRoot("./src/core/database/index.ts"),
      "@pos/types": fromRoot("./src/core/types/index.ts"),
      "@pos/validation": fromRoot("./src/core/validation/index.ts"),
      "@shared": fromRoot("./electron/shared"),
      "@": fromRoot("./src"),
    },
  },
  test: {
    // Main-process and core tests must not import electron: they run in plain Node.
    // React renderer tests get a DOM.
    include: ["src/**/*.test.{ts,tsx}", "electron/**/*.test.ts"],
    environmentMatchGlobs: [
      ["src/core/**", "node"],
      ["src/**", "jsdom"],
    ],
    testTimeout: 15000,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
