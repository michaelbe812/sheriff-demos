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
import { readCachedProjectGraph } from '@nx/devkit';
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { depConstraints } from '../eslint.config.mjs';

const workspaceRoot = join(import.meta.dirname, '..');
const RULE = '@nx/enforce-module-boundaries';

const DEEP = 'no-restricted-imports';
const HTTP = "import { HttpClient } from '@angular/common/http';";

/** [rule, fromLib, importStatement, expected: 'red' | 'green', eslintRule?] */
const cases = [
  // inversion
  ['feat -> infra', 'libs/booking/feat-check-booking/feature', "import '@blueprint/booking/infra';", 'red'],
  ['shell -> infra (wiring)', 'libs/booking/shell', "import '@blueprint/booking/infra';", 'green'],
  ['api -> infra', 'libs/booking/api', "import '@blueprint/booking/infra';", 'red'],
  ['data -> infra', 'libs/booking/data', "import '@blueprint/booking/infra';", 'red'],
  ['data -> api (port)', 'libs/booking/data', "import '@blueprint/booking/api';", 'green'],
  ['infra -> api (implements)', 'libs/booking/infra', "import '@blueprint/booking/api';", 'green'],
  // layer matrix
  ['ui -> api', 'libs/booking/ui', "import '@blueprint/booking/api';", 'red'],
  ['ui -> data', 'libs/booking/ui', "import '@blueprint/booking/data';", 'red'],
  ['ui -> events', 'libs/booking/ui', "import '@blueprint/booking/events';", 'green'],
  ['types -> anything', 'libs/booking/types', "import '@blueprint/shared/types';", 'red'],
  ['utils -> events', 'libs/booking/utils', "import '@blueprint/booking/events';", 'red'],
  ['events -> data', 'libs/booking/events', "import '@blueprint/booking/data';", 'red'],
  ['infra -> data', 'libs/booking/infra', "import '@blueprint/booking/data';", 'red'],
  ['feature -> shell', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/shell';", 'red'],
  ['feature -> data/ui/events', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/data';", 'green'],
  // scope isolation
  ['cross-scope internals', 'libs/checkin/data', "import '@blueprint/booking/data';", 'red'],
  ['cross-scope infra', 'libs/checkin/feat-checkin/data', "import '@blueprint/booking/infra';", 'red'],
  ['cross-scope via port', 'libs/checkin/data', "import '@blueprint/booking/api';", 'green'],
  ['shared-feature internals', 'libs/checkin/feat-checkin/feature', "import '@blueprint/auth/data';", 'red'],
  ['shared-feature via port', 'libs/checkin/feat-checkin/feature', "import '@blueprint/auth/api';", 'green'],
  ['shell -> foreign shell', 'libs/checkin/shell', "import '@blueprint/booking/shell';", 'red'],
  // feat isolation
  ['sibling feat internals', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/feat-check-booking/data';", 'red'],
  ['sibling feat root', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/feat-check-booking';", 'red'],
  ['feat -> own feat-local lib', 'libs/booking/feat-check-booking/feature', "import '@blueprint/booking/feat-check-booking/data';", 'green'],
  ['feat-port -> own feat data', 'libs/booking/feat-check-booking/api', "import '@blueprint/booking/feat-check-booking/data';", 'red'],
  ['sibling feat via feat-port', 'libs/booking/feat-manage-booking/feature', "import '@blueprint/booking/feat-check-booking/api';", 'green'],
  ['foreign feat-port', 'libs/checkin/feat-history/feature', "import '@blueprint/booking/feat-check-booking/api';", 'red'],
  ['slice-shared -> feat lib', 'libs/booking/data', "import '@blueprint/booking/feat-check-booking/data';", 'red'],
  ['shell -> feat (lazy)', 'libs/booking/shell', "export const load = () => import('@blueprint/booking/feat-check-booking');", 'green'],
  // shared
  ['shared -> slice port', 'libs/shared/utils', "import '@blueprint/booking/api';", 'red'],
  ['shared utils -> shared api', 'libs/shared/utils', "import '@blueprint/shared/api';", 'red'],
  ['slice -> shared', 'libs/booking/utils', "import '@blueprint/shared/utils';", 'green'],
  // app
  ['app -> data', 'apps/client/src/app', "import '@blueprint/booking/data';", 'red'],
  ['app -> infra', 'apps/client/src/app', "import '@blueprint/booking/infra';", 'red'],
  ['app -> feat-port', 'apps/client/src/app', "import '@blueprint/booking/feat-check-booking/api';", 'red'],
  ['app -> shell / port / shared', 'apps/client/src/app', "import '@blueprint/booking/shell';", 'green'],
  ['lib -> app', 'libs/booking/data', "import '../../../../apps/client/src/app/app';", 'red'],
  // encapsulation
  ['relative import across libs', 'libs/booking/feat-manage-booking/feature', "import '../../../data/src/booking.store';", 'red'],
  ['deep import into lib', 'libs/checkin/feat-history/feature', "import '@blueprint/checkin/data/src/internal/checkin.mapper';", 'red', DEEP],
  ['deep import cross-scope', 'libs/checkin/data', "import '@blueprint/booking/data/src/booking.store';", 'red', DEEP],
  ['untagged project (noTag)', 'packages/sheriff-blueprint/src', "import '@blueprint/shared/utils';", 'red'],
  // npm
  ['HttpClient in data', 'libs/booking/data', HTTP, 'red'],
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
const projects = Object.values(readCachedProjectGraph().nodes);
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
