import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/_generated/**",
        "src/**/*.test.ts",
        "src/**/fixtures/**",
        "src/test.ts",
        "src/test-helpers.ts",
        "src/component/convex.config.ts",
        "src/component/crons.ts",
      ],
      thresholds: { statements: 90, branches: 85 },
    },
  },
});
