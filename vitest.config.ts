import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/api/**/*.test.ts", "tests/printing/**/*.test.ts"],
    testTimeout: 10_000
  },
  resolve: {
    alias: {
      "@mts-lbmp/shared": new URL("./packages/shared/src/index.ts", import.meta.url).pathname,
      "@mts-lbmp/permissions": new URL("./packages/permissions/src/index.ts", import.meta.url).pathname,
      "@mts-lbmp/printing": new URL("./packages/printing/src/index.ts", import.meta.url).pathname
    }
  }
});
