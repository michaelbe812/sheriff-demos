#!/usr/bin/env node
/**
 * Reproducible negative + positive tests for the blueprint's Nx boundaries.
 *
 * Every case lints ONE virtual file (ESLint `lintText` with a filePath inside
 * a real lib) through the real eslint.config.mjs and asserts whether a
 * boundary rule fires. Nothing is written to the source tree except two
 * temporary libs, removed in `finally`: an untagged one (project.json with
 * no tags) for the "noTag" case and a new one with only src/index.ts, which
 * the plugin must infer as a tagged, constrained project.
 * On top, a tag-schema check guards the plugin's tags against the folder layout,
 * a test-isolation check the non-lint layers keeping test code out of
 * production, and a client build proves the bundle carries no msw/vitest.
 *
 * Usage: node tools/verify-boundaries.mjs   (exit 1 on any mismatch)
 */
import { createProjectGraphAsync } from '@nx/devkit';
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const workspaceRoot = join(import.meta.dirname, '..');
process.chdir(workspaceRoot);
process.env.NX_DAEMON ??= 'false';

const BOUNDARY_RULES = ['@nx/enforce-module-boundaries', 'no-restricted-imports'];
const UNTAGGED_LIB = 'libs/tmp-verify-untagged';
// a brand-new lib: only a folder + src/index.ts — the plugin must turn it into a tagged, constrained project
const NEW_LIB = 'libs/tmpverify/utils';
const NEW_LIB_ALIAS = '@blueprint/tmpverify/utils';
const NEW_LIB_EXPECTED = { name: 'tmpverify-utils', tags: ['scope:tmpverify', 'type:utils', 'feat:none'], targets: ['build', 'lint', 'typecheck'] };
const CYCLE = 'Circular dependency';

// generated OpenAPI clients (tools/openapi-facade): one shared, one domain-owned
const PET = '@blueprint/generated/pet-client';
const BOOKING_CLIENT = '@blueprint/booking/generated/booking-client';
/** Lint header the facade writes into every generated file — only the boundary rules stay on. */
const GENERATED_HEADER = '/* eslint-disable */\n/* eslint-enable @nx/enforce-module-boundaries, no-restricted-imports */\n';

const blocked = (rule, from, importPath, expectedText) => ({ rule, from, importPath, expectedText, allowed: false });
const allowed = (rule, from, importPath) => ({ rule, from, importPath, allowed: true });
// same, but the virtual file is a spec (`tmp-verify.spec.ts`) → spec override applies
const blockedInSpec = (...args) => ({ ...blocked(...args), spec: true });
const allowedInSpec = (...args) => ({ ...allowed(...args), spec: true });
// same, but the virtual file lives in <lib>/src/generated/ and carries the facade's lint header
const blockedInGenerated = (...args) => ({ ...blocked(...args), generated: true });
const allowedInGenerated = (...args) => ({ ...allowed(...args), generated: true });

const cases = [
  // layer matrix (type axis)
  blocked('layer: ui -> data', 'libs/booking/ui', '@blueprint/booking/data', 'type:ui'),
  blocked('layer: ui -> api', 'libs/booking/ui', '@blueprint/booking/api', 'type:ui'),
  blocked('layer: utils -> api (in shared)', 'libs/shared/utils', '@blueprint/shared/api', 'type:utils'),
  // types -> types only (incl. generated models, see generated cases)
  allowed('layer: types -> types', 'libs/booking/types', '@blueprint/shared/types'),
  blocked('layer: types -> utils', 'libs/booking/types', '@blueprint/shared/utils', 'type:types'),
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

  // testing: test-only libs never reach production code
  // buildable lib -> non-buildable testing lib: `enforceBuildableLibDependency` answers first ...
  blocked('testing: production -> testing', 'libs/booking/data', '@blueprint/booking/testing', 'non-buildable'),
  blocked('testing: feature -> testing', 'libs/booking/feat-check-booking/feature', '@blueprint/booking/testing', 'non-buildable'),
  // ... the tag constraints block it on their own, too (buildable check switched off)
  { ...blocked('testing: production -> testing (tags only)', 'libs/booking/data', '@blueprint/booking/testing', 'type:data'), tagsOnly: true },
  { ...blocked('testing: feature -> testing (tags only)', 'libs/booking/feat-check-booking/feature', '@blueprint/booking/testing', 'type:feature'), tagsOnly: true },
  blocked('testing: app -> shared/testing', 'apps/client/src/app', '@blueprint/shared/testing', 'type:app'),
  allowedInSpec('testing: spec -> own testing', 'libs/booking/data', '@blueprint/booking/testing'),
  allowedInSpec('testing: spec -> foreign domain testing', 'libs/checkin/feat-checkin/feature', '@blueprint/booking/testing'),
  allowedInSpec('testing: spec -> shared/testing', 'libs/shared/api', '@blueprint/shared/testing'),
  blockedInSpec('testing: shared spec -> domain testing', 'libs/shared/api', '@blueprint/booking/testing', 'scope:shared'),
  blockedInSpec('testing: spec keeps layer rules (ui -> data)', 'libs/booking/ui', '@blueprint/booking/data', 'type:ui'),
  blockedInSpec('testing: types spec -> testing (cycle)', 'libs/booking/types', '@blueprint/booking/testing', [CYCLE, 'type:types']),
  // booking/data has specs against booking/testing: the edge back is a cycle
  blocked('testing: testing -> data', 'libs/booking/testing', '@blueprint/booking/data', [CYCLE, 'type:testing']),
  blocked('testing: testing -> data (no cycle)', 'libs/booking/testing', '@blueprint/auth/data', 'type:testing'),
  blocked('testing: testing -> api (port)', 'libs/booking/testing', '@blueprint/booking/api', 'type:testing'),
  blocked('testing: testing -> foreign domain testing', 'libs/checkin/testing', '@blueprint/booking/testing', 'scope:checkin'),
  allowed('testing: testing -> types', 'libs/booking/testing', '@blueprint/booking/types'),
  allowed('testing: testing -> shared/testing', 'libs/booking/testing', '@blueprint/shared/testing'),
  blocked('testing: msw in production', 'libs/booking/api', 'msw', 'msw'),
  blocked('testing: msw/browser in production', 'libs/booking/data', 'msw/browser', 'msw/browser'),
  blocked('testing: vitest in production', 'libs/booking/ui', 'vitest', 'vitest'),
  blocked('testing: @vitest/* in app', 'apps/client/src/app', '@vitest/browser-playwright', '@vitest/browser-playwright'),
  allowed('testing: msw in testing lib', 'libs/booking/testing', 'msw'),
  allowedInSpec('testing: msw + vitest in spec', 'libs/booking/data', 'msw'),

  // generated clients: services = type:api, models = type:types, core = type:api; scope from the folder
  allowed('generated: domain api -> own client api', 'libs/booking/api', `${BOOKING_CLIENT}/api`),
  allowed('generated: domain api -> own client types', 'libs/booking/api', `${BOOKING_CLIENT}/types`),
  allowed('generated: domain api -> own client core', 'libs/booking/api', `${BOOKING_CLIENT}/core`),
  allowed('generated: domain api -> shared client api', 'libs/booking/api', `${PET}/api`),
  allowed('generated: domain api -> shared client core', 'libs/checkin/api', `${PET}/core`),
  blocked('generated: foreign domain -> domain client api', 'libs/checkin/api', `${BOOKING_CLIENT}/api`, 'scope:checkin'),
  blocked('generated: foreign domain -> domain client types', 'libs/checkin/types', `${BOOKING_CLIENT}/types`, 'scope:checkin'),
  blocked('generated: foreign feat -> domain client', 'libs/checkin/feat-checkin/data', `${BOOKING_CLIENT}/api`, 'scope:checkin'),
  blocked('generated: ui -> client api', 'libs/booking/ui', `${BOOKING_CLIENT}/api`, 'type:ui'),
  blocked('generated: ui -> client core', 'libs/booking/ui', `${BOOKING_CLIENT}/core`, 'type:ui'),
  blocked('generated: shared ui -> shared client api', 'libs/shared/ui', `${PET}/api`, 'type:ui'),
  allowed('generated: ui -> client types', 'libs/booking/ui', `${BOOKING_CLIENT}/types`),
  allowed('generated: data -> client api (matrix)', 'libs/booking/data', `${BOOKING_CLIENT}/api`),
  allowed('generated: feature -> client api (matrix)', 'libs/booking/feat-check-booking/feature', `${BOOKING_CLIENT}/api`),
  blocked('generated: utils -> client api', 'libs/booking/utils', `${BOOKING_CLIENT}/api`, 'type:utils'),
  blocked('generated: domain types -> client api', 'libs/booking/types', `${BOOKING_CLIENT}/api`, 'type:types'),
  allowed('generated: domain types -> own client types (types -> types)', 'libs/booking/types', `${BOOKING_CLIENT}/types`),
  allowed('generated: domain types -> shared client types', 'libs/booking/types', `${PET}/types`),
  blocked('generated: shared types -> domain client types', 'libs/shared/types', `${BOOKING_CLIENT}/types`, 'scope:shared'),
  allowed('generated: shared types -> shared client types', 'libs/shared/types', `${PET}/types`),
  blocked('generated: app -> domain client (no port)', 'apps/client/src/app', `${BOOKING_CLIENT}/api`, 'type:app'),
  blocked('generated: deep import into client lib', 'libs/booking/api', `${BOOKING_CLIENT}/types/src/generated/model/booking`, 'Deep import'),
  // ... and FROM generated code (lint header: everything off except the boundary rules)
  blockedInGenerated('generated code: types -> api (same client)', 'libs/booking/generated/booking-client/types', `${BOOKING_CLIENT}/api`, [CYCLE, 'type:types']),
  blockedInGenerated('generated code: types -> core (same client)', 'libs/booking/generated/booking-client/types', `${BOOKING_CLIENT}/core`, [CYCLE, 'type:types']),
  blockedInGenerated('generated code: types -> other client api (no cycle)', 'libs/booking/generated/booking-client/types', `${PET}/api`, 'type:types'),
  blockedInGenerated('generated code: types -> @angular/core', 'libs/generated/pet-client/types', '@angular/core', '@angular/core'),
  blockedInGenerated('generated code: shared client -> domain client', 'libs/generated/pet-client/api', `${BOOKING_CLIENT}/types`, 'scope:shared'),
  blockedInGenerated('generated code: client api -> domain data', 'libs/booking/generated/booking-client/api', '@blueprint/booking/data', [CYCLE, 'type:api']),
  blockedInGenerated('generated code: client api -> events (no cycle)', 'libs/booking/generated/booking-client/api', '@blueprint/booking/events', 'type:api'),
  blockedInGenerated('generated code: deep import', 'libs/booking/generated/booking-client/api', `${BOOKING_CLIENT}/types/src/generated/model/booking`, 'Deep import'),
  allowedInGenerated('generated code: api -> core + types', 'libs/booking/generated/booking-client/api', `${BOOKING_CLIENT}/core`),
  allowedInGenerated('generated code: api -> @angular/common/http', 'libs/generated/pet-client/api', '@angular/common/http'),
  allowedInGenerated('generated code: core -> @angular/common/http', 'libs/generated/pet-client/core', '@angular/common/http'),

  // new lib (only src/index.ts, created for this run): tags + constraints apply without any config
  blocked('new lib: layer rules (utils -> api)', NEW_LIB, '@blueprint/shared/api', 'type:utils'),
  blocked('new lib: own scope constraint generated', NEW_LIB, '@blueprint/booking/utils', 'scope:tmpverify'),
  allowed('new lib: -> shared', NEW_LIB, '@blueprint/shared/utils'),
  blocked('new lib: foreign slice only via port', 'libs/booking/data', NEW_LIB_ALIAS, 'scope:booking'),
  blocked('new lib: deep alias import', 'libs/booking/utils', `${NEW_LIB_ALIAS}/src/internal`, 'Deep import'),
];

/**
 * Tag schema vs folder layout. The tags are inferred by
 * tools/nx-plugins/blueprint-libs.ts, so this guards the plugin:
 * every libs/<lib>/src/index.ts must be a project and carry exactly the expected tags.
 */
function checkTagSchema(projectGraph) {
  const problems = [];
  // libs = projects with an alias; the generated client containers (libs/**/generated/<client>) have none
  const libs = Object.values(projectGraph.nodes).filter(
    (node) => node.data.root.startsWith('libs/') && node.data.root !== UNTAGGED_LIB && node.data.metadata?.js?.packageName,
  );
  const markerRoots = readdirSync('libs', { recursive: true })
    .filter((f) => f.endsWith('src/index.ts'))
    .map((f) => join('libs', dirname(dirname(f))));
  for (const root of markerRoots) {
    if (!libs.some((node) => node.data.root === root)) problems.push(`${root}: has src/index.ts but is no project`);
  }
  for (const { data } of libs) {
    const libPath = data.root.slice('libs/'.length);
    const tags = data.tags ?? [];
    const [scope, ...rest] = libPath.split('/');
    const layer = rest.at(-1);
    const featFolder = rest.find((segment) => segment.startsWith('feat-'));
    const expectTag = (tag) => tags.includes(tag) || problems.push(`libs/${libPath}: missing "${tag}"`);
    const expectOne = (prefix) =>
      tags.filter((t) => t.startsWith(prefix)).length === 1 || problems.push(`libs/${libPath}: needs exactly one "${prefix}*" tag`);

    ['scope:', 'type:', 'feat:'].forEach(expectOne);
    const generatedAt = libPath.split('/').indexOf('generated');
    if (generatedAt !== -1) {
      // libs/generated/<client>/<part> → shared, libs/<domain>/generated/<client>/<part> → domain; core is api (HTTP)
      expectTag(`scope:${generatedAt === 0 ? 'shared' : scope}`);
      expectTag(`type:${layer === 'types' ? 'types' : 'api'}`);
      expectTag('feat:none');
      expectTag('generated');
      if (tags.some((t) => t === 'port' || t === 'entry' || t === 'feat-port')) problems.push(`libs/${libPath}: generated lib must not be port/entry`);
      continue;
    }
    expectTag(`scope:${scope}`);
    expectTag(`type:${['shell', 'feature'].includes(layer) ? 'feature' : layer}`);
    expectTag(featFolder ? `feat:${featFolder.slice('feat-'.length)}` : 'feat:none');
    if (layer === 'shell') expectTag('entry');
    if (layer === 'api' && scope !== 'shared') expectTag(featFolder ? 'feat-port' : 'port');
  }
  return { count: libs.length, problems };
}

/**
 * Test-only code never ships — the static layers besides the lint rules,
 * read from the project graph (targets are inferred by the plugin):
 * no build target for testing libs, specs out of the lib build tsconfig and
 * the build's `production` inputs, a `test` target exactly where specs exist,
 * the MSW worker nowhere near the app.
 */
function checkTestIsolation(projectGraph) {
  const problems = [];
  const production = JSON.parse(readFileSync('nx.json', 'utf-8')).namedInputs.production;
  if (!production.includes('!{projectRoot}/**/*.spec.ts')) problems.push('nx.json: production input must exclude specs');
  const libs = Object.values(projectGraph.nodes).filter(
    ({ data }) => data.root.startsWith('libs/') && data.root !== UNTAGGED_LIB && data.metadata?.js?.packageName,
  );
  for (const { data } of libs) {
    const { root, tags = [], targets = {} } = data;
    if (tags.includes('type:testing') && targets.build) problems.push(`${root}: type:testing must not have a build target`);
    if (targets.build) {
      const tsConfig = targets.build.options?.tsConfig?.replace('{projectRoot}', root);
      const { exclude = [] } = tsConfig ? JSON.parse(readFileSync(tsConfig, 'utf-8')) : {};
      if (!exclude.some((pattern) => pattern.endsWith('*.spec.ts'))) problems.push(`${root}: build tsconfig ${tsConfig} must exclude *.spec.ts`);
      if (!targets.build.inputs?.includes('production')) problems.push(`${root}: build inputs must be "production" (no specs)`);
    }
    const hasSpecs = readdirSync(join(root, 'src'), { recursive: true }).some((f) => f.endsWith('.spec.ts'));
    if (hasSpecs !== Boolean(targets.test)) problems.push(`${root}: test target ${hasSpecs ? 'missing' : 'without specs'}`);
  }
  const workerInApps = readdirSync('apps', { recursive: true }).filter((f) => f.endsWith('mockServiceWorker.js'));
  workerInApps.forEach((f) => problems.push(`apps/${f}: MSW worker must only live in libs/shared/testing/public`));
  const appProjects = readdirSync('apps', { recursive: true }).filter((f) => f.endsWith('project.json'));
  for (const file of appProjects) {
    const text = readFileSync(join('apps', file), 'utf-8');
    if (/testing|msw/i.test(text)) problems.push(`apps/${file}: references testing/msw (assets?)`);
  }
  return { count: libs.length, problems };
}

/**
 * Generated OpenAPI clients, read from the project graph: every client part lib runs its client's
 * `generate` before lint/typecheck/build, every lib target waits for `^generate` (consumers), the
 * client's `generate` is cached with the spec as input and the src/generated folders as outputs.
 * Committed: only openapi.yaml + src/index.ts per part — nothing below src/generated/ (gitignored).
 */
function checkGeneratedClients(projectGraph) {
  const problems = [];
  const nodes = Object.values(projectGraph.nodes).filter(({ data }) => data.root.startsWith('libs/'));
  const clients = nodes.filter(({ data }) => data.tags?.includes('generated') && !data.metadata?.js?.packageName);
  const parts = nodes.filter(({ data }) => data.tags?.includes('generated') && data.metadata?.js?.packageName);
  for (const { name, data } of clients) {
    const generate = data.targets?.generate;
    if (!generate?.cache) problems.push(`${name}: generate must be cached`);
    if (!generate?.inputs?.includes('{projectRoot}/openapi.yaml')) problems.push(`${name}: spec must be a generate input`);
    if (!generate?.outputs?.every((output) => output.endsWith('/src/generated'))) problems.push(`${name}: outputs must be the src/generated folders`);
  }
  for (const { name, data } of parts) {
    const client = data.root.split('/').slice(0, -1).join('/');
    const clientNode = clients.find((node) => node.data.root === client);
    if (!clientNode) problems.push(`${name}: no client project at ${client} (openapi.yaml missing?)`);
    const pointsToClient = data.targets?.generate?.dependsOn?.some((dep) => dep.projects?.includes(clientNode?.name) && dep.target === 'generate');
    if (!pointsToClient) problems.push(`${name}: generate must depend on ${clientNode?.name}:generate`);
    for (const target of ['lint', 'typecheck', 'build']) {
      if (!data.targets?.[target]?.dependsOn?.includes('generate')) problems.push(`${name}: ${target} must depend on generate`);
    }
  }
  for (const { name, data } of nodes.filter(({ data }) => data.metadata?.js?.packageName)) {
    for (const [target, config] of Object.entries(data.targets ?? {})) {
      if (target !== 'generate' && !config.dependsOn?.includes('^generate')) problems.push(`${name}: ${target} must depend on ^generate`);
    }
  }
  const committedGenerated = execFileSync('git', ['ls-files', 'libs'], { encoding: 'utf-8' })
    .split('\n')
    .filter((file) => file.includes('/src/generated/'));
  committedGenerated.forEach((file) => problems.push(`${file}: generated code is committed`));
  const generatedFiles = readdirSync('libs', { recursive: true })
    .map((file) => join('libs', String(file)))
    .filter((file) => file.includes('/src/generated/') && statSync(file).isFile());
  const notIgnored = generatedFiles.filter((file) => {
    try {
      execFileSync('git', ['check-ignore', '-q', file]);
      return false;
    } catch {
      return true;
    }
  });
  notIgnored.forEach((file) => problems.push(`${file}: generated but not gitignored`));
  return { clients: clients.length, parts: parts.length, generatedFiles: generatedFiles.length, problems };
}

/**
 * Libs have no config files (same guard as packages/tooling): project, tags, targets and build files
 * come from the plugins and the ng-lib executors. Any of these below libs/ outside a src/ folder is
 * an error — except the shared libs/tsconfig*.json. openapi.yaml (client spec) is no config file;
 * the client options live in nx.json. Runs before the temporary libs of this script exist.
 */
const LIB_CONFIG_FILE = /^(project\.json|package\.json|ng-package\.json|tsconfig.*\.json|eslint\.config\.[cm]?[jt]s)$/;
const SHARED_LIB_CONFIG = /^libs\/tsconfig[^/]*\.json$/;

function checkLibConfigFiles() {
  const files = readdirSync('libs', { recursive: true }).map((file) => join('libs', String(file)));
  const problems = files
    .filter((file) => LIB_CONFIG_FILE.test(file.split('/').at(-1)))
    .filter((file) => !SHARED_LIB_CONFIG.test(file) && !file.split('/').includes('src'))
    .map((file) => `${file}: config file in a lib — libs have none, remove it`);
  return { count: files.length, problems };
}

/** Builds the client and scans the bundle for any trace of MSW or Vitest. */
function checkClientBundle() {
  const problems = [];
  try {
    execFileSync('pnpm', ['exec', 'nx', 'run', 'client:build', '--skip-nx-cache'], { stdio: 'pipe' });
  } catch (error) {
    return { problems: [`client:build failed: ${error.stderr?.toString().slice(0, 300) ?? error.message}`], files: 0 };
  }
  const distDir = 'dist/apps/client';
  const files = readdirSync(distDir, { recursive: true }).filter((f) => statSync(join(distDir, f)).isFile());
  const testOnlyMarkers = /\bmsw\b|mockServiceWorker|setupWorker|vitest/i;
  for (const file of files) {
    if (testOnlyMarkers.test(file) || testOnlyMarkers.test(readFileSync(join(distDir, file), 'latin1'))) {
      problems.push(`${distDir}/${file}: contains msw/vitest`);
    }
  }
  return { problems, files: files.length };
}

/** The real config, but without `enforceBuildableLibDependency` — isolates the tag constraints. */
async function createTagsOnlyEslint() {
  const { blueprintDepConstraints } = await import('../eslint.config.mjs');
  const rule = ['error', { enforceBuildableLibDependency: false, depConstraints: blueprintDepConstraints }];
  return new ESLint({
    cwd: workspaceRoot,
    overrideConfig: { files: ['**/*.ts'], rules: { '@nx/enforce-module-boundaries': rule } },
  });
}

/** The new lib must come out of the plugin exactly like a hand-written project.json would have it. */
function checkNewLib(projectGraph) {
  const node = Object.values(projectGraph.nodes).find(({ data }) => data.root === NEW_LIB);
  if (!node) return { problems: [`${NEW_LIB}: not inferred as project`] };
  const actual = { name: node.name, tags: node.data.tags, targets: Object.keys(node.data.targets).sort() };
  const same = JSON.stringify(actual) === JSON.stringify(NEW_LIB_EXPECTED);
  return { actual, problems: same ? [] : [`${NEW_LIB}: expected ${JSON.stringify(NEW_LIB_EXPECTED)}, got ${JSON.stringify(actual)}`] };
}

function createNewLib() {
  mkdirSync(join(NEW_LIB, 'src'), { recursive: true });
  writeFileSync(join(NEW_LIB, 'src/index.ts'), 'export const probe = 1;\n');
}

function createUntaggedLib() {
  mkdirSync(join(UNTAGGED_LIB, 'src'), { recursive: true });
  writeFileSync(join(UNTAGGED_LIB, 'project.json'), JSON.stringify({ name: 'tmp-verify-untagged', tags: [] }));
}

async function lintCase({ from, importPath, spec, generated }, eslint) {
  const fileName = spec ? 'tmp-verify.spec.ts' : 'tmp-verify.ts';
  const filePath = join(workspaceRoot, from, from.startsWith('apps/') ? '' : 'src', generated ? 'generated' : '', fileName);
  const code = `${generated ? GENERATED_HEADER : ''}import { probe } from '${importPath}';\nexport const used = probe;\n`;
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => BOUNDARY_RULES.includes(m.ruleId));
}

async function main() {
  const libConfigs = checkLibConfigFiles();
  createUntaggedLib();
  createNewLib();
  try {
    // the Nx rule silently skips without a cached graph — build it first
    const projectGraph = await createProjectGraphAsync({ exitOnError: true });
    const schema = checkTagSchema(projectGraph);
    const isolation = checkTestIsolation(projectGraph);
    const newLib = checkNewLib(projectGraph);
    const clients = checkGeneratedClients(projectGraph);
    const eslint = new ESLint({ cwd: workspaceRoot });
    const eslintTagsOnly = await createTagsOnlyEslint();

    const rows = [];
    for (const testCase of cases) {
      const findings = await lintCase(testCase, testCase.tagsOnly ? eslintTagsOnly : eslint);
      const text = findings.map((f) => f.message).join(' | ');
      const pass = testCase.allowed
        ? findings.length === 0
        : findings.length > 0 && [testCase.expectedText].flat().some((expected) => text.includes(expected));
      rows.push({ ...testCase, pass, text });
    }
    const bundle = checkClientBundle();
    report(rows, schema, isolation, newLib, bundle);
    console.log(`Generierte Clients: ${clients.clients} Clients, ${clients.parts} Teil-Libs, ${clients.generatedFiles} generierte Dateien (alle gitignored, keine committet), Targets/dependsOn: ${clients.problems.length} Probleme`);
    clients.problems.forEach((p) => console.log(`  - ${p}`));
    console.log(`Config-Dateien in libs/ (außer libs/tsconfig*.json): ${libConfigs.count} Dateien geprüft, ${libConfigs.problems.length} Treffer`);
    libConfigs.problems.forEach((p) => console.log(`  - ${p}`));
    const problems = [schema, isolation, newLib, bundle, clients, libConfigs].flatMap((check) => check.problems);
    process.exitCode = rows.every((r) => r.pass) && problems.length === 0 ? 0 : 1;
  } finally {
    rmSync(UNTAGGED_LIB, { recursive: true, force: true });
    rmSync(dirname(NEW_LIB), { recursive: true, force: true });
  }
}

function report(rows, schema, isolation, newLib, bundle) {
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
  console.log(`Test-Isolation (${isolation.count} Libs aus dem Graph: kein build für testing, Specs aus Build-tsconfig/production, test nur mit Specs, Worker nicht in apps): ${isolation.problems.length} Probleme`);
  isolation.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`Neue Lib (nur ${NEW_LIB}/src/index.ts): ${newLib.problems.length ? 'NICHT ' : ''}automatisch Projekt ${JSON.stringify(newLib.actual ?? {})}`);
  newLib.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`client-Bundle: ${bundle.files} Dateien auf msw/vitest geprüft, ${bundle.problems.length} Treffer`);
  bundle.problems.forEach((p) => console.log(`  - ${p}`));
}

await main();
