#!/usr/bin/env node
/**
 * Proof that the build setup still works after `nx migrate` / an Angular update. With explicit config per
 * lib the standard executors do the work (@nx/angular:ng-packagr-lite, :application, :unit-test); left are
 * one Nx internal (the ng-lib test wrapper imports @nx/angular's unit-test impl, Nx loads its `hasher`) and
 * behaviour the blueprint relies on (the app build maps lib aliases to dist via the lib package.json names,
 * Vitest serves the MSW worker). After every update run:
 *
 *   pnpm verify:nx-internals                     full proof (≈ 2–3 min)
 *   pnpm verify:nx-internals --reference <dir>   dist compared with a copy made before the update
 *   pnpm verify:nx-internals --update-snapshot   accept a new dist (after reviewing why it changed)
 *
 * Steps (exit 1 if any fails):
 *   1. run-many build lint test typecheck --skip-nx-cache (into a fresh dist/)
 *   2. dist equivalence: sha256 of every file in dist/ vs. the committed snapshot
 *      (packages/tooling/verify/nx-internals/dist-hashes.json) or `diff -r` against --reference
 *   3. marker: a text in dist/libs/layout/ui is replaced, client:build without task dependencies
 *      must bundle the marker → the app is built against dist, not silently from source
 *      (@nx/angular:application with buildLibsFromSource: false, alias from the lib's package.json)
 *   4. MSW: without the default handlers (`beforeEach(() => worker.use(...))`) booking-data:test must fail
 *   5. MSW worker: the browser gets `/mockServiceWorker.js` of the installed msw package, served by
 *      Vitest itself (`vitest:browser:resolve-virtual`, no publicDir, no committed copy) — a Vitest
 *      internal, so checked here: version + integrity checksum of the served script
 *   6. Vitest UI (`test --ui`): Nx still loads the custom hasher of ng-lib:test (executors.json `hasher`),
 *      a UI task gets a one-off hash (never a cache hit), a normal task the unchanged Nx hash
 *   7. tooling-verify:verify (boundaries, tag schema, config guard, bundle scan)
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const workspaceRoot = join(import.meta.dirname, '../../../..');
process.chdir(workspaceRoot);
process.env.NX_DAEMON ??= 'false';

const SNAPSHOT = 'packages/tooling/verify/nx-internals/dist-hashes.json';
const MARKER_FILE = 'dist/libs/layout/ui/esm2022/nav-bar.js';
const MARKER_TEXT = 'Bookings';
const SPEC_FILE = 'libs/booking/data/src/booking.store.spec.ts';
const DEFAULT_HANDLERS_LINE = '  beforeEach(() => worker.use(...bookingHandlers));\n';
const WORKER_PROBE_SPEC = 'libs/booking/api/src/tmp-msw-worker.spec.ts';

const args = process.argv.slice(2);
const reference = args.includes('--reference') ? args[args.indexOf('--reference') + 1] : undefined;
const updateSnapshot = args.includes('--update-snapshot');

const nx = (...nxArgs) => execFileSync('pnpm', ['exec', 'nx', ...nxArgs], { stdio: 'pipe', encoding: 'utf-8' });
const results = [];

function step(name, run) {
  process.stdout.write(`… ${name}\n`);
  try {
    const detail = run();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: String(error.stdout ?? '').slice(-600) + (error.message ?? error) });
  }
}

async function stepAsync(name, run) {
  process.stdout.write(`… ${name}\n`);
  try {
    results.push({ name, ok: true, detail: await run() });
  } catch (error) {
    results.push({ name, ok: false, detail: String(error.message ?? error) });
  }
}

function filesBelow(dir) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => statSync(join(dir, file)).isFile())
    .sort();
}

function hashDist() {
  return Object.fromEntries(
    filesBelow('dist').map((file) => [file, createHash('sha256').update(readFileSync(join('dist', file))).digest('hex')]),
  );
}

function compareDist() {
  const actual = hashDist();
  if (reference) {
    const expected = Object.fromEntries(
      filesBelow(reference).map((file) => [file, createHash('sha256').update(readFileSync(join(reference, file))).digest('hex')]),
    );
    return diffHashes(expected, actual, `reference ${reference}`);
  }
  if (updateSnapshot || !existsSync(SNAPSHOT)) {
    mkdirSync(dirname(SNAPSHOT), { recursive: true });
    writeFileSync(SNAPSHOT, JSON.stringify(actual, null, 2) + '\n');
    return `snapshot written: ${Object.keys(actual).length} files`;
  }
  return diffHashes(JSON.parse(readFileSync(SNAPSHOT, 'utf-8')), actual, SNAPSHOT);
}

function diffHashes(expected, actual, against) {
  const files = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  const changed = files.filter((file) => expected[file] !== actual[file]);
  if (changed.length) {
    throw new Error(`dist differs from ${against} in ${changed.length} files:\n  ${changed.slice(0, 20).join('\n  ')}`);
  }
  return `${files.length} files identical to ${against}`;
}

function markerAppBuildsAgainstDist() {
  const original = readFileSync(MARKER_FILE, 'utf-8');
  const marker = `NX_INTERNALS_MARKER_${Date.now()}`;
  if (!original.includes(MARKER_TEXT)) throw new Error(`${MARKER_FILE} does not contain "${MARKER_TEXT}"`);
  try {
    writeFileSync(MARKER_FILE, original.replace(MARKER_TEXT, marker));
    nx('run', 'client:build', '--skip-nx-cache', '--exclude-task-dependencies');
    const bundle = filesBelow('dist/apps/client/browser').filter((file) => file.endsWith('.js'));
    const hit = bundle.find((file) => readFileSync(join('dist/apps/client/browser', file), 'utf-8').includes(marker));
    if (!hit) throw new Error('marker not in the client bundle → the app was built from source, not from dist');
    return `marker in dist/apps/client/browser/${hit}`;
  } finally {
    // restore dist exactly: original lib file, client rebuilt against it
    writeFileSync(MARKER_FILE, original);
    nx('run', 'client:build', '--skip-nx-cache', '--exclude-task-dependencies');
  }
}

function missingHandlerFailsTest() {
  const original = readFileSync(SPEC_FILE, 'utf-8');
  // Vitest browser mode stores a screenshot of the failing test next to the spec
  const screenshots = join(dirname(SPEC_FILE), '__screenshots__');
  const hadScreenshots = existsSync(screenshots);
  if (!original.includes(DEFAULT_HANDLERS_LINE)) throw new Error(`${SPEC_FILE}: default handler line not found`);
  try {
    writeFileSync(SPEC_FILE, original.replace(DEFAULT_HANDLERS_LINE, ''));
    try {
      nx('run', 'booking-data:test', '--skip-nx-cache');
    } catch (error) {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      if (!output.includes('without a matching request handler')) throw new Error('booking-data:test failed, but not because of MSW');
      return 'booking-data:test red: "[MSW] … without a matching request handler"';
    }
    throw new Error('booking-data:test stayed green without default handlers');
  } finally {
    writeFileSync(SPEC_FILE, original);
    if (!hadScreenshots) rmSync(screenshots, { recursive: true, force: true });
  }
}

/** Temporary spec: the served worker must be the one of node_modules/msw (version + checksum). */
function mswWorkerServedByVitest() {
  const installed = readFileSync('node_modules/msw/lib/mockServiceWorker.js', 'utf-8');
  const version = JSON.parse(readFileSync('node_modules/msw/package.json', 'utf-8')).version;
  const checksum = /INTEGRITY_CHECKSUM = '([^']+)'/.exec(installed)?.[1];
  const screenshots = join(dirname(WORKER_PROBE_SPEC), '__screenshots__');
  const hadScreenshots = existsSync(screenshots);
  writeFileSync(
    WORKER_PROBE_SPEC,
    `import { test } from '@blueprint/shared/testing';
import { bypass } from 'msw';
import { expect } from 'vitest';

test('serves the worker of the installed msw package', async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  const text = await (await fetch(bypass('/mockServiceWorker.js'))).text();
  expect(registration?.active?.scriptURL).toMatch(/\\/mockServiceWorker\\.js$/);
  expect(/PACKAGE_VERSION = '([^']+)'/.exec(text)?.[1]).toBe('${version}');
  expect(/INTEGRITY_CHECKSUM = '([^']+)'/.exec(text)?.[1]).toBe('${checksum}');
});
`,
  );
  try {
    nx('run', 'booking-api:test', '--skip-nx-cache');
    return `msw ${version} (checksum ${checksum}) served by Vitest`;
  } finally {
    rmSync(WORKER_PROBE_SPEC, { force: true });
    if (!hadScreenshots) rmSync(screenshots, { recursive: true, force: true });
  }
}

/** ng-lib:test hashes `--ui` runs one-off (Vitest UI is never replayed from the cache), normal runs unchanged. */
async function uiRunsNeverCached() {
  const require = createRequire(import.meta.url);
  const { getExecutorInformation } = require('nx/src/command-line/run/executor-utils');
  const { hasherFactory } = getExecutorInformation('@blueprint/tooling-ng-lib', 'test', workspaceRoot, {});
  if (!hasherFactory) throw new Error('Nx no longer reads the `hasher` of @blueprint/tooling-ng-lib:test (executors.json)');
  const hasher = hasherFactory();
  const context = { hasher: { hashTask: async () => ({ value: '123', details: {} }) }, taskGraph: {}, env: {} };
  const normal = await hasher({ overrides: {} }, context);
  const [ui1, ui2] = await Promise.all([1, 2].map(() => hasher({ overrides: { ui: true } }, context)));
  if (normal.value !== '123') throw new Error(`normal test: hash changed (${normal.value})`);
  if (ui1.value === ui2.value || ui1.value === '123') throw new Error('test --ui: hash not one-off');
  return 'hasher loaded by Nx, normal hash unchanged, --ui one-off';
}

if (!args.includes('--skip-run-many')) {
  step('run-many build lint test typecheck --skip-nx-cache', () => {
    // fresh dist: leftovers of removed libs would fail the equivalence check
    rmSync('dist', { recursive: true, force: true });
    nx('run-many', '-t', 'build', 'lint', 'test', 'typecheck', '--skip-nx-cache');
    return 'green';
  });
}
step('dist equivalence', compareDist);
step('marker: app builds against dist', markerAppBuildsAgainstDist);
step('MSW: missing handler turns the test red', missingHandlerFailsTest);
step('MSW worker: served by Vitest from the msw package', mswWorkerServedByVitest);
await stepAsync('Vitest UI: test --ui never from the cache', uiRunsNeverCached);
step('tooling-verify:verify', () => {
  nx('run', 'tooling-verify:verify', '--skip-nx-cache');
  return 'green';
});

console.log('');
for (const { name, ok, detail } of results) console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
