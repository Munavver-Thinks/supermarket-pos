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
    // Every test lives in src/tests/, mirroring the path of the code it covers
    // (src/tests/electron/... for the main process). Core and main-process tests must not
    // import electron: they run in plain Node. React renderer tests get a DOM.
    include: ["src/tests/**/*.test.{ts,tsx}"],
    environmentMatchGlobs: [
      ["src/tests/core/**", "node"],
      ["src/tests/electron/**", "node"],
      ["src/tests/**", "jsdom"],
    ],
    testTimeout: 15000,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
