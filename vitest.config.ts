import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Main-process tests must not import electron: they run in plain Node.
    include: ["packages/**/src/**/*.test.ts", "apps/pos-desktop/src/main/**/*.test.ts"],
    testTimeout: 15000,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
