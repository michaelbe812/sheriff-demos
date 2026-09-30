import { defineConfig } from 'vitest/config';

/**
 * Node tests of @blueprint/tooling-openapi, two projects:
 *   unit         src/**\/*.spec.{ts,mts} — Tree/fixture based, fast
 *   integration  test/integration/**\/*.spec.mts — real adapters (openapi-generator jar + Java, hey-api,
 *                nx-plugin-openapi), orval/openapi-typescript/openapi-msw, tsc, local HTTP server, executors
 * Target `test` runs BOTH with coverage: the thresholds apply to their sum
 * (fast unit-only run without Nx: `pnpm exec vitest run --config packages/tooling/openapi/vitest.config.mts --project unit`).
 */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    environment: 'node',
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.spec.{ts,mts}'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.spec.mts'],
          // the jar (openapi-tools) takes 2–5 s per run
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,mjs,js}'],
      exclude: [
        'src/**/*.spec.{ts,mts}',
        // types only (the adapter contract): no runtime code to cover
        'src/**/*.d.ts',
      ],
      reportsDirectory: 'coverage',
      reporter: ['text', 'html', 'json-summary', 'lcov'],
      // fails the run below 95 % (goal: as close to 100 % as sensible, see README)
      thresholds: { lines: 95, branches: 95, functions: 95, statements: 95 },
    },
  },
});
