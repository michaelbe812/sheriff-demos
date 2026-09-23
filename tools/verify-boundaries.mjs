#!/usr/bin/env node
/**
 * Reproducible negative + positive tests for the blueprint's Nx boundaries.
 *
 * Every case lints ONE virtual file (ESLint `lintText` with a filePath inside
 * a real lib) through the real eslint.config.mjs and asserts whether a
 * boundary rule fires. Nothing is written to the source tree except one
 * temporary untagged lib for the "noTag" case, removed in `finally`.
 * On top, a tag-schema check guards the conventions Nx itself cannot see.
 *
 * Usage: node tools/verify-boundaries.mjs   (exit 1 on any mismatch)
 */
import { createProjectGraphAsync } from '@nx/devkit';
import { ESLint } from 'eslint';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const workspaceRoot = join(import.meta.dirname, '..');
process.chdir(workspaceRoot);
process.env.NX_DAEMON ??= 'false';

const BOUNDARY_RULES = ['@nx/enforce-module-boundaries', 'no-restricted-imports'];
const UNTAGGED_LIB = 'libs/tmp-verify-untagged';
const CYCLE = 'Circular dependency';

const blocked = (rule, from, importPath, expectedText) => ({ rule, from, importPath, expectedText, allowed: false });
const allowed = (rule, from, importPath) => ({ rule, from, importPath, allowed: true });

const cases = [
  // layer matrix (type axis)
  blocked('layer: ui -> data', 'libs/booking/ui', '@blueprint/booking/data', 'type:ui'),
  blocked('layer: ui -> api', 'libs/booking/ui', '@blueprint/booking/api', 'type:ui'),
  blocked('layer: utils -> api (in shared)', 'libs/shared/utils', '@blueprint/shared/api', 'type:utils'),
  blocked('layer: types -> nothing', 'libs/booking/types', '@blueprint/shared/types', 'type:types'),
  blocked('layer: events -> data', 'libs/booking/events', '@blueprint/booking/data', ['type:events', CYCLE]),
  blocked('layer: api -> data', 'libs/booking/api', '@blueprint/booking/data', ['type:api', CYCLE]),
  // without a cycle the layer constraint itself answers (type axis is checked before scope)
  blocked('layer: events -> data (no cycle)', 'libs/booking/events', '@blueprint/auth/data', 'type:events'),
  blocked('layer: api -> data (no cycle)', 'libs/booking/api', '@blueprint/auth/data', 'type:api'),
  blocked('layer: data -> ui', 'libs/booking/data', '@blueprint/booking/ui', 'type:data'),
  allowed('layer: ui -> events', 'libs/booking/ui', '@blueprint/booking/events'),
  allowed('layer: data -> api', 'libs/booking/data', '@blueprint/booking/api'),
  allowed('layer: feature -> data/ui', 'libs/booking/feat-check-booking/feature', '@blueprint/booking/ui'),

  // scope axis (domains + shared features)
  blocked('scope: foreign domain internals', 'libs/checkin/data', '@blueprint/booking/data', 'scope:checkin'),
  allowed('scope: foreign domain via port', 'libs/checkin/data', '@blueprint/booking/api'),
  blocked('scope: shared-feature internals', 'libs/checkin/feat-checkin/feature', '@blueprint/auth/data', 'scope:checkin'),
  allowed('scope: shared-feature via port', 'libs/checkin/feat-checkin/feature', '@blueprint/auth/api'),
  blocked('scope: foreign entry', 'libs/booking/shell', '@blueprint/checkin/shell', 'scope:booking'),
  blocked('scope: shared -> domain', 'libs/shared/utils', '@blueprint/checkin/utils', 'scope:shared'),
  allowed('scope: domain -> shared', 'libs/booking/utils', '@blueprint/shared/utils'),

  // feat isolation
  blocked('feat: sibling feat internals', 'libs/checkin/feat-history/feature', '@blueprint/checkin/feat-checkin/data', 'feat:history'),
  blocked('feat: sibling feat container', 'libs/booking/feat-manage-booking/feature', '@blueprint/booking/feat-check-booking/feature', 'feat:manage-booking'),
  allowed('feat: sibling via feat-port', 'libs/checkin/feat-history/feature', '@blueprint/checkin/feat-checkin/api'),
  blocked('feat: foreign feat-port', 'libs/booking/feat-manage-booking/feature', '@blueprint/checkin/feat-checkin/api', 'scope:booking'),
  allowed('feat: own feat internals', 'libs/booking/feat-check-booking/feature', '@blueprint/booking/feat-check-booking/data'),
  allowed('feat: domain-shared from feat', 'libs/booking/feat-check-booking/data', '@blueprint/booking/data'),

  // app isolation / app shell
  blocked('app: shell -> slice internals', 'apps/client/src/app', '@blueprint/booking/ui', 'type:app'),
  blocked('app: shell -> data', 'apps/client/src/app', '@blueprint/booking/data', 'type:app'),
  allowed('app: shell -> entry', 'apps/client/src/app', '@blueprint/layout/shell'),
  blocked('app: static import of lazy entry', 'apps/client/src/app', '@blueprint/booking/shell', 'lazy-loaded'),
  allowed('app: shell -> port', 'apps/client/src/app', '@blueprint/booking/api'),
  blocked('app: lib -> app', 'libs/booking/utils', 'apps/client/src/app/app', 'Projects cannot be imported by a relative or absolute path'),

  // encapsulation (public API = index.ts)
  blocked('encapsulation: relative into foreign lib', 'libs/checkin/ui', '../../data/src/internal/checkin.mapper', 'Projects cannot be imported by a relative or absolute path'),
  blocked('encapsulation: deep alias import', 'libs/checkin/feat-checkin/data', '@blueprint/checkin/data/src/internal/checkin.mapper', 'Deep import'),

  // Nx-only extras
  blocked('nx: http only in api', 'libs/booking/ui', '@angular/common/http', '@angular/common/http'),
  allowed('nx: http in api', 'libs/booking/api', '@angular/common/http'),
  blocked('nx: types framework-free', 'libs/booking/types', '@angular/core', '@angular/core'),
  blocked('nx: no cycles', 'libs/booking/data', '@blueprint/booking/feat-check-booking/data', CYCLE),
  blocked('nx: untagged lib (noTag)', UNTAGGED_LIB, '@blueprint/shared/utils', 'without tags'),
];

/** Conventions Nx cannot enforce: tag schema must match the folder layout. */
function checkTagSchema() {
  const problems = [];
  const projectFiles = readdirSync('libs', { recursive: true }).filter((f) => f.endsWith('project.json'));
  for (const file of projectFiles) {
    const libPath = dirname(file);
    const tags = JSON.parse(readFileSync(join('libs', file), 'utf-8')).tags ?? [];
    const [scope, ...rest] = libPath.split('/');
    const layer = rest.at(-1);
    const featFolder = rest.find((segment) => segment.startsWith('feat-'));
    const expectTag = (tag) => tags.includes(tag) || problems.push(`libs/${libPath}: missing "${tag}"`);
    const expectOne = (prefix) =>
      tags.filter((t) => t.startsWith(prefix)).length === 1 || problems.push(`libs/${libPath}: needs exactly one "${prefix}*" tag`);

    ['scope:', 'type:', 'feat:'].forEach(expectOne);
    expectTag(`scope:${scope}`);
    expectTag(`type:${['shell', 'feature'].includes(layer) ? 'feature' : layer}`);
    expectTag(featFolder ? `feat:${featFolder.slice('feat-'.length)}` : 'feat:none');
    if (layer === 'shell') expectTag('entry');
    if (layer === 'api' && scope !== 'shared') expectTag(featFolder ? 'feat-port' : 'port');
  }
  return { count: projectFiles.length, problems };
}

function createUntaggedLib() {
  mkdirSync(join(UNTAGGED_LIB, 'src'), { recursive: true });
  writeFileSync(join(UNTAGGED_LIB, 'project.json'), JSON.stringify({ name: 'tmp-verify-untagged', tags: [] }));
}

async function lintCase({ from, importPath }, eslint) {
  const filePath = join(workspaceRoot, from, from.startsWith('apps/') ? '' : 'src', 'tmp-verify.ts');
  const code = `import { probe } from '${importPath}';\nexport const used = probe;\n`;
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => BOUNDARY_RULES.includes(m.ruleId));
}

async function main() {
  const schema = checkTagSchema();
  createUntaggedLib();
  try {
    // the Nx rule silently skips without a cached graph — build it first
    await createProjectGraphAsync({ exitOnError: true });
    const eslint = new ESLint({ cwd: workspaceRoot });

    const rows = [];
    for (const testCase of cases) {
      const findings = await lintCase(testCase, eslint);
      const text = findings.map((f) => f.message).join(' | ');
      const pass = testCase.allowed
        ? findings.length === 0
        : findings.length > 0 && [testCase.expectedText].flat().some((expected) => text.includes(expected));
      rows.push({ ...testCase, pass, text });
    }
    report(rows, schema);
    process.exitCode = rows.every((r) => r.pass) && schema.problems.length === 0 ? 0 : 1;
  } finally {
    rmSync(UNTAGGED_LIB, { recursive: true, force: true });
  }
}

function report(rows, schema) {
  console.log('| Regel | von | Import | erwartet | Ergebnis |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) {
    const expected = r.allowed ? 'erlaubt' : 'blockiert';
    const firstLine = r.text.split('\n')[0].replaceAll('|', '/').slice(0, 90);
    const actual = r.pass ? `✅ ${firstLine}` : `❌ ${firstLine || 'keine Meldung'}`;
    console.log(`| ${r.rule} | \`${r.from}\` | \`${r.importPath}\` | ${expected} | ${actual} |`);
  }
  const passed = rows.filter((r) => r.pass).length;
  console.log(`\n${passed}/${rows.length} Fälle ok`);
  console.log(`Tag-Schema: ${schema.count} Libs geprüft, ${schema.problems.length} Probleme`);
  schema.problems.forEach((p) => console.log(`  - ${p}`));
}

await main();
