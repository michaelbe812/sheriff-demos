// @nx/angular:unit-test (Vitest browser mode) — passed through unchanged, plus Vitest UI as a flag.
//
// Libs carry their own ng-package.json, tsconfig.spec.json and an @nx/angular:ng-packagr-lite build target,
// so @nx/angular:unit-test works as is. This wrapper exists only for `nx run <lib>:test --ui` (one test target,
// no `test:ui` configuration): with `ui` it switches to watch + headed browsers (`chromiumHeadless` →
// `chromium`, Angular then shows the preview in the UI; `--headless` keeps headless), and the hasher of this
// executor (test-hasher.js) keeps UI runs out of the cache. Without `ui` the options go through unchanged.
const unitTestExecutor = require('@nx/angular/src/executors/unit-test/unit-test.impl').default;

/** `ui` → watch + headed browsers; otherwise unchanged. */
function withUiDefaults(options) {
  if (!options.ui) return options;
  const browsers = options.browsers?.map((browser) => browser.replace(/Headless$/, ''));
  return { ...options, watch: true, ...(browsers && { browsers }) };
}

async function* ngLibTestExecutor(options, context) {
  return yield* unitTestExecutor(withUiDefaults(options), context);
}

module.exports = ngLibTestExecutor;
module.exports.default = ngLibTestExecutor;
