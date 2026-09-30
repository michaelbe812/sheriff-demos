import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Base config for the Angular unit-test builder (`runnerConfig`). Only test
 * runs load it — the app build never sees MSW or its service worker.
 */
const mswPublicDir = join(import.meta.dirname, 'libs/shared/testing/public');

/**
 * Serves `libs/shared/testing/public/mockServiceWorker.js` as
 * `/mockServiceWorker.js`. Set via plugin because the Angular builder builds
 * the Vitest project config itself and only forwards plugins into it.
 */
function mswPublicDirPlugin(): Plugin {
  return {
    name: 'blueprint:msw-public-dir',
    config: () => ({ publicDir: mswPublicDir }),
  };
}

/**
 * The Angular builder pre-bundles every external package the specs import
 * (`optimizeDeps.include`), Vitest browser mode excludes `msw` from
 * pre-bundling. esbuild rejects "include + exclude" ("The entry point "msw"
 * cannot be marked as external") — keep Vitest's exclude, drop the include.
 */
function mswNotPrebundledPlugin(): Plugin {
  return {
    name: 'blueprint:msw-not-prebundled',
    configResolved(config) {
      const { optimizeDeps } = config;
      optimizeDeps.include = optimizeDeps.include?.filter((id) => !optimizeDeps.exclude?.includes(id));
    },
  };
}

export default defineConfig({
  plugins: [mswPublicDirPlugin(), mswNotPrebundledPlugin()],
});
