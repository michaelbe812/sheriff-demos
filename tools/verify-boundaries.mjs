#!/usr/bin/env node
/**
 * Reproducible positive/negative tests for the Nx module boundaries.
 *
 *   node tools/verify-boundaries.mjs
 *
 * Every case lints a virtual probe file inside a real lib (ESLint `lintText`
 * with a `filePath`) against the SAME flat config `nx lint` resolves for that
 * project, in three variants of the @nx/enforce-module-boundaries options:
 *
 *   real       the committed config
 *   tags-only  cycle check neutralised — proves the tag / external-import
 *              constraint itself rejects the import, not just a cycle
 *   catch-all  committed config + { sourceTag: '*', onlyDependOnLibsWithTags:
 *              ['*'] } — proves a catch-all cannot widen anything in Nx
 *
 * Also checks tag hygiene (one scope + one type per lib, a constraint for every
 * tag) and that the accepted domain <-> port-out cycle really needs its ignore.
 * Exits 1 on any mismatch.
 */
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.NX_DAEMON = 'false';
const { ESLint } = await import('eslint');
const { createProjectGraphAsync } = await import('nx/src/devkit-exports.js');

const WORKSPACE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOUNDARY_RULE = '@nx/enforce-module-boundaries';
const RESTRICTED_IMPORTS_RULE = '@typescript-eslint/no-restricted-imports';

const APP = 'apps/hexagonal-demo/src/app';
const lib = (name) => `libs/${name}/src/lib`;

/** [id, source dir, import statement, expected, rule?] — V# = __violations.example.ts */
const CASES = [
  ['domain -> eigener adapter-driven (V3)', lib('booking/domain'), `import { InMemoryBookingRepository } from '@hex/booking/adapter-driven';`, 'red'],
  ['domain -> eigener adapter-driving', lib('booking/domain'), `import { BookingPage } from '@hex/booking/adapter-driving';`, 'red'],
  ['domain -> eigener port-out', lib('booking/domain'), `import { BOOKING_REPOSITORY } from '@hex/booking/port-out';`, 'green'],
  ['domain -> eigene providers (entry)', lib('booking/domain'), `import { provideBooking } from '@hex/booking/providers';`, 'red'],
  ['adapter-driving -> port-out', lib('booking/adapter-driving'), `import { BOOKING_REPOSITORY } from '@hex/booking/port-out';`, 'red'],
  ['adapter-driving -> adapter-driven', lib('booking/adapter-driving'), `import { SystemClock } from '@hex/booking/adapter-driven';`, 'red'],
  ['adapter-driving -> eigene domain (store)', lib('booking/adapter-driving'), `import { BookingStore } from '@hex/booking/domain';`, 'green'],
  ['adapter-driven -> port-in', lib('booking/adapter-driven'), `import { BOOKING_API } from '@hex/booking/port-in';`, 'red'],
  ['adapter-driven -> port-out', lib('booking/adapter-driven'), `import { BOOKING_CLOCK } from '@hex/booking/port-out';`, 'green'],
  ['port-in -> port-out', lib('booking/port-in'), `import { BOOKING_CLOCK } from '@hex/booking/port-out';`, 'red'],
  ['port-out -> adapter-driven', lib('booking/port-out'), `import { SystemClock } from '@hex/booking/adapter-driven';`, 'red'],
  ['cross-slice: domain -> fremde domain (V1)', lib('booking/domain'), `import { CustomerStore } from '@hex/customer/domain';`, 'red'],
  ['cross-slice: domain -> fremder adapter (V2)', lib('booking/domain'), `import { InMemoryCustomerRepository } from '@hex/customer/adapter-driven';`, 'red'],
  ['cross-slice: domain -> fremder port-in', lib('booking/domain'), `import { CUSTOMER_API } from '@hex/customer/port-in';`, 'green'],
  ['cross-slice: domain -> fremder port-out', lib('booking/domain'), `import { CUSTOMER_REPOSITORY } from '@hex/customer/port-out';`, 'red'],
  ['cross-slice: domain -> fremde shell (entry)', lib('booking/domain'), `import { customerRoutes } from '@hex/customer/shell';`, 'red'],
  ['cross-slice: adapter-driving -> fremde domain', lib('customer/adapter-driving'), `import { BookingStore } from '@hex/booking/domain';`, 'red'],
  ['cross-slice: shell -> fremde providers', lib('customer/shell'), `import { provideBooking } from '@hex/booking/providers';`, 'red'],
  ['shell -> eigener adapter-driving', lib('booking/shell'), `import { BookingPage } from '@hex/booking/adapter-driving';`, 'green'],
  ['providers -> eigener adapter-driven', lib('booking/providers'), `import { SystemClock } from '@hex/booking/adapter-driven';`, 'green'],
  ['domain -> @angular/core', lib('booking/domain'), `import { signal } from '@angular/core';`, 'green'],
  ['domain -> HttpClient (V4)', lib('booking/domain'), `import { HttpClient } from '@angular/common/http';`, 'red'],
  ['domain -> @angular/router', lib('booking/domain'), `import { Router } from '@angular/router';`, 'red'],
  ['domain -> rxjs/ajax', lib('booking/domain'), `import { ajax } from 'rxjs/ajax';`, 'red'],
  ['domain -> rxjs', lib('booking/domain'), `import { map } from 'rxjs';`, 'green'],
  ['adapter-driving -> HttpClient', lib('booking/adapter-driving'), `import { HttpClient } from '@angular/common/http';`, 'red'],
  ['adapter-driven -> HttpClient', lib('booking/adapter-driven'), `import { HttpClient } from '@angular/common/http';`, 'green'],
  ['domain -> shared-ui', lib('booking/domain'), `import { MoneyPipe } from '@hex/shared/ui';`, 'red'],
  ['domain -> shared-util', lib('booking/domain'), `import { formatMoney } from '@hex/shared/util';`, 'green'],
  ['adapter-driving -> shared-ui', lib('booking/adapter-driving'), `import { MoneyPipe } from '@hex/shared/ui';`, 'green'],
  ['shared-util -> domain', lib('shared/util'), `import { totalPrice } from '@hex/booking/domain';`, 'red'],
  ['shared-ui -> domain', lib('shared/ui'), `import { BookingStore } from '@hex/booking/domain';`, 'red'],
  ['shared-ui -> port-in', lib('shared/ui'), `import { CUSTOMER_API } from '@hex/customer/port-in';`, 'red'],
  ['shared-ui -> shared-util', lib('shared/ui'), `import { formatMoney } from '@hex/shared/util';`, 'green'],
  ['shared-types -> shared-util', lib('shared/types'), `import { formatMoney } from '@hex/shared/util';`, 'red'],
  ['shared-types -> rxjs (keine externals)', lib('shared/types'), `import { Observable } from 'rxjs';`, 'red'],
  ['shared-ui -> @angular/router (allSourceTags)', lib('shared/ui'), `import { RouterLink } from '@angular/router';`, 'red'],
  ['app -> shell lazy (entry)', APP, `export const load = () => import('@hex/booking/shell');`, 'green'],
  ['app -> shell statisch (lazy lib)', APP, `import { bookingRoutes } from '@hex/booking/shell';`, 'red'],
  ['app -> providers statisch (entry)', APP, `import { provideCustomerApi } from '@hex/customer/providers';`, 'green'],
  ['app -> port-in', APP, `import { CUSTOMER_API } from '@hex/customer/port-in';`, 'green'],
  ['app -> domain', APP, `import { BookingStore } from '@hex/booking/domain';`, 'red'],
  ['app -> adapter-driving', APP, `import { BookingPage } from '@hex/booking/adapter-driving';`, 'red'],
  ['app -> fremde app', APP, `import { App } from '../../../client/src/app/app';`, 'red'],
  ['deep import an public API vorbei', lib('booking/adapter-driving'), `import { CustomerStore } from '../../../../customer/domain/src/lib/customer.store';`, 'red'],
  ['port-out: value-import der domain', lib('booking/port-out'), `import { totalPrice } from '@hex/booking/domain';`, 'red', RESTRICTED_IMPORTS_RULE],
  ['port-out: type-import der domain', lib('booking/port-out'), `import type { Booking } from '@hex/booking/domain';`, 'green', RESTRICTED_IMPORTS_RULE],
];

const VARIANTS = {
  real: (options) => options,
  'tags-only': (options) => ({ ...options, ignoredCircularDependencies: [['*', '*']] }),
  'catch-all': (options) => ({
    ...options,
    depConstraints: [...options.depConstraints, { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }],
  }),
};

/** Same lookup as the Nx lint executor: nearest eslint.config.mjs upwards. */
function nearestConfigFile(directory) {
  for (let current = join(WORKSPACE_ROOT, directory); ; current = dirname(current)) {
    const candidate = join(current, 'eslint.config.mjs');
    if (existsSync(candidate)) return candidate;
    if (current === WORKSPACE_ROOT) throw new Error(`no eslint.config.mjs above ${directory}`);
  }
}

function withBoundaryOptions(configArray, variant) {
  return configArray.map((entry) => {
    const rule = entry.rules?.[BOUNDARY_RULE];
    if (!rule) return entry;
    const [severity, options] = rule;
    return { ...entry, rules: { ...entry.rules, [BOUNDARY_RULE]: [severity, VARIANTS[variant](options)] } };
  });
}

const eslintCache = new Map();
async function eslintFor(directory, variant) {
  const configFile = nearestConfigFile(directory);
  const key = `${configFile}|${variant}`;
  if (!eslintCache.has(key)) {
    const { default: configArray } = await import(pathToFileURL(configFile).href);
    eslintCache.set(
      key,
      new ESLint({ cwd: WORKSPACE_ROOT, overrideConfigFile: true, overrideConfig: withBoundaryOptions(configArray, variant) }),
    );
  }
  return eslintCache.get(key);
}

async function lintProbe(directory, code, variant, ruleId) {
  const eslint = await eslintFor(directory, variant);
  const [result] = await eslint.lintText(`${code}\n`, { filePath: join(WORKSPACE_ROOT, directory, '__probe__.ts') });
  return result.messages.filter((message) => message.ruleId === ruleId && message.severity === 2);
}

const firstLine = (message) => message?.message.split('\n')[0] ?? '';
const verdict = (errors) => (errors.length > 0 ? 'red' : 'green');

async function runCase([name, directory, code, expected, ruleId = BOUNDARY_RULE]) {
  const results = {};
  for (const variant of Object.keys(VARIANTS)) {
    results[variant] = await lintProbe(directory, code, variant, ruleId);
  }
  const verdicts = Object.values(results).map(verdict);
  const tagsOnlyCaughtByCycle = results['tags-only'].some((m) => m.messageId === 'noCircularDependencies');
  const passed = verdicts.every((v) => v === expected) && !tagsOnlyCaughtByCycle;
  const message = firstLine(results.real[0]);
  const tagsOnlyMessage = firstLine(results['tags-only'][0]);
  return { name, expected, verdicts, passed, message: tagsOnlyMessage !== message ? `${message} / tags-only: ${tagsOnlyMessage}` : message };
}

/** The domain <-> port-out ignore is load-bearing: without it the legal import is red. */
async function checkCycleIgnoreIsNeeded() {
  VARIANTS['no-cycle-ignore'] = (options) => ({ ...options, ignoredCircularDependencies: [] });
  const errors = await lintProbe(lib('booking/domain'), `import { BOOKING_REPOSITORY } from '@hex/booking/port-out';`, 'no-cycle-ignore', BOUNDARY_RULE);
  delete VARIANTS['no-cycle-ignore'];
  return errors.some((m) => m.messageId === 'noCircularDependencies') ? [] : ['domain -> port-out is not circular without the ignore — drop ignoredCircularDependencies'];
}

function checkTagHygiene(graph, depConstraints) {
  const problems = [];
  const constrainedTags = new Set(depConstraints.flatMap((c) => c.allSourceTags ?? [c.sourceTag]));
  const covered = (tag) => [...constrainedTags].some((t) => t === tag || (t.endsWith('*') && tag.startsWith(t.slice(0, -1))));
  for (const node of Object.values(graph.nodes)) {
    const { tags = [], root } = node.data;
    const count = (prefix) => tags.filter((tag) => tag.startsWith(prefix)).length;
    if (node.type === 'lib' && (count('scope:') !== 1 || count('type:') !== 1)) {
      problems.push(`${node.name}: needs exactly one scope:* and one type:* tag (${tags.join(', ')})`);
    }
    if (node.type === 'app' && count('app:') !== 1) problems.push(`${node.name}: needs exactly one app:* tag`);
    for (const tag of tags.filter((t) => /^(scope|type|app):/.test(t))) {
      if (!covered(tag)) problems.push(`${node.name}: tag ${tag} has no depConstraint (${relative(WORKSPACE_ROOT, root)})`);
    }
  }
  return problems;
}

const graph = await createProjectGraphAsync({ exitOnError: true });
const { moduleBoundaryOptions } = await import(pathToFileURL(join(WORKSPACE_ROOT, 'eslint.config.mjs')).href);

const results = [];
for (const testCase of CASES) results.push(await runCase(testCase));
const problems = [...checkTagHygiene(graph, moduleBoundaryOptions.depConstraints), ...(await checkCycleIgnoreIsNeeded())];

console.log(`| # | Fall | erwartet | ${Object.keys(VARIANTS).join(' | ')} | ok | Meldung |`);
console.log(`|---|---|---|${Object.keys(VARIANTS).map(() => '---').join('|')}|---|---|`);
results.forEach(({ name, expected, verdicts, passed, message }, index) => {
  console.log(`| ${index + 1} | ${name} | ${expected} | ${verdicts.join(' | ')} | ${passed ? 'ok' : 'FAIL'} | ${message.replaceAll('|', '\\|')} |`);
});

const failed = results.filter((result) => !result.passed);
problems.forEach((problem) => console.log(`FAIL ${problem}`));
console.log(`\n${results.length - failed.length}/${results.length} Faelle ok, ${problems.length} Hygiene-Probleme`);
process.exit(failed.length + problems.length > 0 ? 1 : 0);
