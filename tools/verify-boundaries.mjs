#!/usr/bin/env node
/**
 * Reproducible negative/positive tests for the Nx architecture rules.
 *
 * Lints a one-line import as if it lived in a file of the given lib (ESLint
 * `lintText` with a virtual filePath — nothing is written to disk) and checks
 * whether `@nx/enforce-module-boundaries` fires.
 *
 * Second, independent check: the tag decision alone. Nx reports a project
 * cycle BEFORE it looks at tags, so e.g. api -> infra shows up as a cycle.
 * For every alias import the depConstraints from eslint.config.mjs are
 * evaluated directly against the project graph, to prove the TAG rule blocks
 * too — the cycle is a second net, not the only one.
 *
 *   node tools/verify-boundaries.mjs            # table + exit code
 *   node tools/verify-boundaries.mjs --markdown # table for docs
 */
import { createProjectGraphAsync } from '@nx/devkit';
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const workspaceRoot = join(import.meta.dirname, '..');

// Throwaway projects, created for this run only (nothing real needs them):
// - one WITHOUT tags for the noTag case (every real project is tagged).
//   Outside libs/: the tag validation in eslint.config.mjs would reject it.
// - a second type:types lib in the booking slice: every slice has exactly one
//   types lib, so types -> types in the own scope needs a second source.
// Not under tmp/: .gitignore'd paths are invisible to Nx. No daemon, so the
// graph sees them immediately.
process.env.NX_DAEMON = 'false';
const UNTAGGED = 'tools/verify-untagged';
const EXTRA_TYPES = 'libs/booking/verify-types';
const throwaways = [
  { dir: UNTAGGED, name: 'verify-untagged', tags: [] },
  { dir: EXTRA_TYPES, name: 'verify-booking-types', tags: ['scope:booking', 'type:types'] },
];
const deleteThrowawayDirs = () => {
  for (const { dir } of throwaways) rmSync(join(workspaceRoot, dir), { recursive: true, force: true });
};
deleteThrowawayDirs();
for (const { dir, name, tags } of throwaways) {
  mkdirSync(join(workspaceRoot, dir, 'src'), { recursive: true });
  writeFileSync(
    join(workspaceRoot, dir, 'project.json'),
    JSON.stringify({ name, projectType: 'library', sourceRoot: `${dir}/src`, tags }),
  );
}
const removeThrowawayProjects = () => {
  deleteThrowawayDirs();
  // drop them from the cached graph again. Fresh process: this one's Nx file
  // index still lists the deleted project.json files.
  execFileSync('pnpm', ['exec', 'nx', 'show', 'projects'], { cwd: workspaceRoot, stdio: 'ignore' });
};

const RULE = '@nx/enforce-module-boundaries';

const DEEP = 'no-restricted-imports';
const HTTP = "import { HttpClient } from '@angular/common/http';";

/** [rule, fromLib, importStatement, expected: 'red' | 'green', eslintRule?] */
const cases = [
  // inversion
  ['feat -> infra', 'libs/booking/feat-check-booking/feature', "import '@blueprint/booking/infra';", 'red'],
  ['shell -> infra (wiring)', 'libs/booking/shell', "import '@blueprint/booking/infra';", 'green'],
  ['api -> infra', 'libs/booking/api', "import '@blueprint/booking/infra';", 'red'],
  ['state -> infra', 'libs/booking/state', "import '@blueprint/booking/infra';", 'red'],
  ['state -> api (port)', 'libs/booking/state', "import '@blueprint/booking/api';", 'green'],
  ['infra -> api (implements)', 'libs/booking/infra', "import '@blueprint/booking/api';", 'green'],
  // layer matrix
  ['ui -> api', 'libs/booking/ui', "import '@blueprint/booking/api';", 'red'],
  ['ui -> state', 'libs/booking/ui', "import '@blueprint/booking/state';", 'red'],
  ['ui -> events', 'libs/booking/ui', "import '@blueprint/booking/events';", 'green'],
  // types: only other types libs — own scope, shared, never a foreign slice
  ['types -> own-scope types', EXTRA_TYPES, "import '@blueprint/booking/types';", 'green'],
  ['types -> shared types', 'libs/booking/types', "import '@blueprint/shared/types';", 'green'],
  ['types -> utils', 'libs/booking/types', "import '@blueprint/booking/utils';", 'red'],
  ['types -> shared utils', 'libs/booking/types', "import '@blueprint/shared/utils';", 'red'],
  ['types -> foreign types', 'libs/checkin/types', "import '@blueprint/booking/types';", 'red'],
  ['types -> foreign port', 'libs/checkin/types', "import '@blueprint/booking/api';", 'red'],
  ['utils -> events', 'libs/booking/utils', "import '@blueprint/booking/events';", 'red'],
  ['events -> state', 'libs/booking/events', "import '@blueprint/booking/state';", 'red'],
  ['infra -> state', 'libs/booking/infra', "import '@blueprint/booking/state';", 'red'],
  ['feature -> shell', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/shell';", 'red'],
  ['feature -> state/ui/events', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/state';", 'green'],
  // scope isolation
  ['cross-scope internals', 'libs/checkin/state', "import '@blueprint/booking/state';", 'red'],
  ['cross-scope infra', 'libs/checkin/feat-checkin/state', "import '@blueprint/booking/infra';", 'red'],
  ['cross-scope via port', 'libs/checkin/state', "import '@blueprint/booking/api';", 'green'],
  ['shared-feature internals', 'libs/checkin/feat-checkin/feature', "import '@blueprint/auth/state';", 'red'],
  ['shared-feature via port', 'libs/checkin/feat-checkin/feature', "import '@blueprint/auth/api';", 'green'],
  ['shell -> foreign shell', 'libs/checkin/shell', "import '@blueprint/booking/shell';", 'red'],
  // feat isolation
  ['sibling feat internals', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/feat-check-booking/state';", 'red'],
  ['sibling feat root', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/feat-check-booking/feature';", 'red'],
  ['feat -> own feat-local lib', 'libs/booking/feat-check-booking/feature', "import '@blueprint/booking/feat-check-booking/state';", 'green'],
  ['feat-port -> own feat state', 'libs/booking/feat-check-booking/api', "import '@blueprint/booking/feat-check-booking/state';", 'red'],
  ['sibling feat via feat-port', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/feat-check-booking/api';", 'green'],
  ['foreign feat-port', 'libs/checkin/feat-history/feature', "import '@blueprint/booking/feat-check-booking/api';", 'red'],
  ['slice-shared -> feat lib', 'libs/booking/state', "import '@blueprint/booking/feat-check-booking/state';", 'red'],
  ['shell -> feat (lazy)', 'libs/booking/shell', "export const load = () => import('@blueprint/booking/feat-check-booking/feature');", 'green'],
  // shared
  ['shared -> slice port', 'libs/shared/utils', "import '@blueprint/booking/api';", 'red'],
  ['shared utils -> shared api', 'libs/shared/utils', "import '@blueprint/shared/api';", 'red'],
  ['slice -> shared', 'libs/booking/utils', "import '@blueprint/shared/utils';", 'green'],
  // app
  ['app -> state', 'apps/client/src/app', "import '@blueprint/booking/state';", 'red'],
  ['app -> infra', 'apps/client/src/app', "import '@blueprint/booking/infra';", 'red'],
  ['app -> feat-port', 'apps/client/src/app', "import '@blueprint/booking/feat-check-booking/api';", 'red'],
  ['app -> shell / port / shared', 'apps/client/src/app', "import '@blueprint/booking/shell';", 'green'],
  ['lib -> app', 'libs/booking/state', "import '../../../../apps/client/src/app/app';", 'red'],
  // encapsulation
  ['relative import across libs', 'libs/booking/feat-manage-booking/feature', "import '../../../state/src/booking.store';", 'red'],
  ['deep import into lib', 'libs/checkin/feat-history/feature', "import '@blueprint/checkin/state/src/internal/checkin.mapper';", 'red', DEEP],
  ['deep import cross-scope', 'libs/checkin/state', "import '@blueprint/booking/state/src/booking.store';", 'red', DEEP],
  ['untagged project (noTag)', `${UNTAGGED}/src`, "import '@blueprint/shared/utils';", 'red'],
  ['tooling -> lib', 'packages/sheriff-blueprint/src', "import '@blueprint/shared/utils';", 'red'],
  // npm
  ['HttpClient in state', 'libs/booking/state', HTTP, 'red'],
  ['HttpClient in feature', 'libs/booking/feat-check-booking/feature', HTTP, 'red'],
  ['HttpClient in api', 'libs/booking/api', HTTP, 'red'],
  ['HttpClient in infra', 'libs/booking/infra', HTTP, 'green'],
  ['HttpClient in app', 'apps/client/src/app', HTTP, 'green'],
];

const eslint = new ESLint({ cwd: workspaceRoot });

async function lintImport(fromLib, code, ruleId = RULE) {
  const srcDir = fromLib.includes('/src') ? fromLib : `${fromLib}/src`;
  const filePath = join(workspaceRoot, srcDir, '__verify-boundaries__.ts');
  const [result] = await eslint.lintText(`${code}\n`, { filePath });
  return result.messages.filter((message) => message.ruleId === ruleId);
}

const shortMessage = (text) => text.split('\n')[0].replace(/\s+/g, ' ').slice(0, 110);

// --- tag decision, mirroring Nx' hasTag (exact | glob | /regex/) ------------
let projectGraph;
try {
  projectGraph = await createProjectGraphAsync({ exitOnError: false });
} catch (error) {
  removeThrowawayProjects();
  throw error;
}
const { depConstraints } = await import('../eslint.config.mjs');
const projects = Object.values(projectGraph.nodes);
const tsPaths = JSON.parse(readFileSync(join(workspaceRoot, 'tsconfig.base.json'), 'utf-8')).compilerOptions.paths;

const projectOf = (dir) =>
  projects
    .filter((project) => dir === project.data.root || dir.startsWith(`${project.data.root}/`))
    .sort((a, b) => b.data.root.length - a.data.root.length)[0];

function hasTag(project, tag) {
  const tags = project.data.tags ?? [];
  if (tag === '*') return true;
  if (tag.startsWith('/') && tag.endsWith('/')) return tags.some((t) => new RegExp(tag.slice(1, -1)).test(t));
  if (tag.includes('*')) return tags.some((t) => new RegExp(`^${tag.split('*').join('.*')}$`).test(t));
  return tags.includes(tag);
}

/** 'blocked by <constraint>' | 'allowed' | null (no lib-to-lib import) */
function tagDecision(fromLib, importPath) {
  const targetFile = tsPaths[importPath]?.[0];
  if (!targetFile) return null;
  const source = projectOf(fromLib);
  const target = projectOf(targetFile.replace(/^\.\//, ''));
  const constraints = depConstraints.filter((c) =>
    (c.allSourceTags ?? [c.sourceTag]).every((tag) => hasTag(source, tag)),
  );
  if (constraints.length === 0) return 'blocked (no constraint = noTag)';
  const violated = constraints.filter(
    (c) =>
      c.onlyDependOnLibsWithTags &&
      (c.onlyDependOnLibsWithTags.length === 0 || !c.onlyDependOnLibsWithTags.some((tag) => hasTag(target, tag))),
  );
  const names = violated.map((c) => (c.allSourceTags ?? [c.sourceTag]).join(' + '));
  return violated.length > 0 ? `blocked by ${names.join(', ')}` : 'allowed';
}

/** Which Nx check fired, in a word. */
function messageKind(message) {
  if (message.startsWith('Circular')) return 'cycle';
  if (message.includes('is not allowed to import')) return 'bannedExternalImports';
  if (message.startsWith('Projects cannot be imported by a relative')) return 'relative import';
  if (message.startsWith('Buildable')) return 'buildable -> non-buildable';
  if (message.includes('Deep import')) return 'no-restricted-imports (deep)';
  return 'tags';
}

const importOf = (code) => code.match(/['"]([^'"]+)['"]/)?.[1] ?? code;

const rows = [];
try {
  for (const [rule, fromLib, code, expected, ruleId] of cases) {
    const violations = await lintImport(fromLib, code, ruleId);
    const actual = violations.length > 0 ? 'red' : 'green';
    const tags = tagDecision(fromLib, importOf(code));
    const tagsAgree = tags === null || (expected === 'red') === tags.startsWith('blocked');
    rows.push({
      rule, fromLib, code, expected, actual, tags,
      passed: actual === expected && tagsAgree,
      message: violations[0] ? shortMessage(violations[0].message) : '',
      kind: violations[0] ? messageKind(violations[0].message) : '',
    });
  }
} finally {
  removeThrowawayProjects();
}

const markdown = process.argv.includes('--markdown');
const libOf = (dir) => dir.replace(/^libs\//, '').replace(/\/src.*$/, '');

if (markdown) {
  console.log('| # | Regel | von | Import | erwartet | ESLint | Tag-Entscheid |');
  console.log('|---|---|---|---|---|---|---|');
  rows.forEach((row, i) =>
    console.log(`| ${i + 1} | ${row.rule} | \`${libOf(row.fromLib)}\` | \`${importOf(row.code)}\` | ${row.expected} | ${row.passed ? '✅' : '❌'} ${row.actual}${row.kind ? ` — ${row.kind}` : ''} | ${row.tags ?? '–'} |`),
  );
} else {
  rows.forEach((row, i) =>
    console.log(`${row.passed ? 'ok  ' : 'FAIL'} ${String(i + 1).padStart(2)} ${row.rule.padEnd(30)} ${row.expected.padEnd(5)} ${(row.tags ?? '').padEnd(60)} ${row.message}`),
  );
}

const failures = rows.filter((row) => !row.passed);
console.log(`\n${rows.length - failures.length}/${rows.length} as expected`);
process.exit(failures.length === 0 ? 0 : 1);
