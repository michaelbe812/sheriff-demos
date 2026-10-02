import { defineConfig } from 'vitest/config';

/** ArchUnitTS architecture tests (node). `globals: true` is required by archunit's `toPassAsync` matcher. */
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['**/*.spec.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 120_000,
  },
});
