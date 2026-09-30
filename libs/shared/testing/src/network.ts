import type { RequestHandler } from 'msw';
import { setupWorker, type SetupWorker } from 'msw/browser';
import { test as baseTest } from 'vitest';

/**
 * One MSW worker for the whole test browser. It starts without handlers:
 * every spec states the handlers it relies on (fixture `handlers`), so a
 * request nobody mocked is an error instead of a silent real fetch.
 */
const worker = setupWorker();

let workerStarted: Promise<unknown> | undefined;

/** Registers the service worker once; later calls reuse the running worker. */
function startWorker(): Promise<unknown> {
  workerStarted ??= worker.start({
    onUnhandledRequest: 'error',
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
  return workerStarted;
}

export interface NetworkFixtures {
  /** Default handlers of a spec — set via `test.override('handlers', () => [...])`. */
  handlers: RequestHandler[];
  /** The MSW worker: `network.use(...)` swaps handlers for a single test. */
  network: SetupWorker;
}

/**
 * Vitest browser-mode `test` with MSW (recipe:
 * https://mswjs.io/docs/recipes/vitest-browser-mode/). `network` is an auto
 * fixture: it runs for every test, applies the spec's default handlers and
 * resets all handlers afterwards. The worker is never stopped.
 */
export const test = baseTest.extend<NetworkFixtures>({
  // Vitest reads fixture dependencies from the destructuring pattern — `{}` = none
  // eslint-disable-next-line no-empty-pattern
  handlers: async ({}, use) => use([]),
  network: [
    async ({ handlers }, use) => {
      await startWorker();
      worker.use(...handlers);
      await use(worker);
      worker.resetHandlers();
    },
    { auto: true },
  ],
});
