#!/usr/bin/env node
/**
 * Proof that the ng-lib executors still work after `nx migrate` / an Angular update.
 * They depend on Nx internals (docs/nx-umsetzung.md → "Kosten und Trade-offs"), so after
 * every update run:
 *
 *   pnpm verify:nx-internals                     full proof (≈ 2–3 min)
 *   pnpm verify:nx-internals --reference <dir>   dist compared with a copy made before the update
 *   pnpm verify:nx-internals --update-snapshot   accept a new dist (after reviewing why it changed)
 *
 * Steps (exit 1 if any fails):
 *   1. run-many build lint test typecheck --skip-nx-cache (into a fresh dist/)
 *   2. dist equivalence: sha256 of every file in dist/ vs. the committed snapshot
 *      (packages/tooling/nx-internals/dist-hashes.json) or `diff -r` against --reference
 *   3. marker: a text in dist/libs/layout/ui is replaced, client:build without task dependencies
 *      must bundle the marker → the app is built against dist, not silently from source
 *   4. MSW: without the default handlers (`beforeEach(() => worker.use(...))`) booking-data:test must fail
 *   5. tooling:verify (boundaries, tag schema, config guard, bundle scan)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const workspaceRoot = join(import.meta.dirname, '../../..');
process.chdir(workspaceRoot);
process.env.NX_DAEMON ??= 'false';

const SNAPSHOT = 'packages/tooling/nx-internals/dist-hashes.json';
const MARKER_FILE = 'dist/libs/layout/ui/esm2022/nav-bar.js';
const MARKER_TEXT = 'Bookings';
const SPEC_FILE = 'libs/booking/data/src/booking.store.spec.ts';
const DEFAULT_HANDLERS_LINE = '  beforeEach(() => worker.use(...bookingHandlers));\n';

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
step('tooling:verify', () => {
  nx('run', 'tooling:verify', '--skip-nx-cache');
  return 'green';
});

console.log('');
for (const { name, ok, detail } of results) console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
