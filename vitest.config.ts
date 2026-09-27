import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/*/test/**/*.test.ts",
      "services/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
    ],
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  server: {
    // Native modules must not be bundled by vite-node.
    deps: {
      external: [/better-sqlite3/],
    },
  },
});
