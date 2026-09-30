#!/usr/bin/env node
/**
 * Reproducible negative + positive tests for the blueprint's Nx boundaries,
 * plus a guard against config files in libs/ (libs have none).
 *
 * Every case lints ONE virtual file (ESLint `lintText` with a filePath inside
 * a real lib) through the real eslint.config.mjs and asserts whether a
 * boundary rule fires. Nothing is written to the source tree except two
 * temporary libs, removed in `finally`: an untagged one (project.json with
 * no tags) for the "noTag" case and a new one with only src/index.ts, which
 * the plugin must infer as a tagged, constrained project.
 * On top, a tag-schema check guards the plugin's tags against the folder layout,
 * a test-isolation check the non-lint layers keeping test code out of
 * production, a client check the generated OpenAPI clients (openapi-clients.json ↔
 * folders ↔ specs ↔ libs, graph edges, targets, nothing committed), and a client
 * build proves the bundle carries no msw/vitest/faker.
 *
 * Usage: node packages/tooling/scripts/verify-boundaries.mjs   (exit 1 on any mismatch)
 */
import { createProjectGraphAsync } from '@nx/devkit';
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const workspaceRoot = join(import.meta.dirname, '../../..');
process.chdir(workspaceRoot);
process.env.NX_DAEMON ??= 'false';

const BOUNDARY_RULES = ['@nx/enforce-module-boundaries', 'no-restricted-imports'];
const UNTAGGED_LIB = 'libs/tmp-verify-untagged';
// a brand-new lib: only a folder + src/index.ts — the plugin must turn it into a tagged, constrained project.
// It lives in a new feat of a known scope: a new scope would need an entry in the scope list (nx.json).
const NEW_LIB = 'libs/booking/feat-tmpverify/ui';
const NEW_LIB_ALIAS = '@blueprint/booking/feat-tmpverify/ui';
// second temporary lib in the same feat: a types lib of the booking scope besides booking/types
const NEW_TYPES_LIB = 'libs/booking/feat-tmpverify/types';
const NEW_LIB_EXPECTED = { name: 'booking-feat-tmpverify-ui', tags: ['scope:booking', 'type:ui', 'feat:tmpverify'], targets: ['build', 'lint', 'typecheck'] };
const CYCLE = 'Circular dependency';

// generated OpenAPI clients (packages/tooling/src/openapi): two shared, one domain-owned
const PET = '@blueprint/generated/pet-client';
const NOTIFICATION = '@blueprint/generated/notification-client';
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
  allowed('layer: types -> types (shared)', 'libs/booking/types', '@blueprint/shared/types'),
  allowed('layer: types -> types (own scope)', NEW_TYPES_LIB, '@blueprint/booking/types'),
  blocked('layer: types -> utils', 'libs/booking/types', '@blueprint/shared/utils', 'type:types'),
  blocked('layer: types -> foreign domain types', 'libs/booking/types', '@blueprint/checkin/types', 'scope:booking'),
  blocked('layer: shared types -> domain types', 'libs/shared/types', '@blueprint/booking/types', 'scope:shared'),
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

  // generated clients: services + core = type:api, models = type:types, testing = type:testing; scope from the folder
  allowed('generated: domain port -> own client api', 'libs/booking/api', `${BOOKING_CLIENT}/api`),
  allowed('generated: domain port -> own client types', 'libs/booking/api', `${BOOKING_CLIENT}/types`),
  allowed('generated: domain port -> own client core', 'libs/booking/api', `${BOOKING_CLIENT}/core`),
  allowed('generated: domain port -> shared client api', 'libs/checkin/api', `${NOTIFICATION}/api`),
  allowed('generated: shared api -> shared client api', 'libs/shared/api', `${PET}/api`),
  blocked('generated: foreign domain -> domain client api', 'libs/checkin/api', `${BOOKING_CLIENT}/api`, 'scope:checkin'),
  blocked('generated: foreign domain -> domain client types', 'libs/checkin/types', `${BOOKING_CLIENT}/types`, 'scope:checkin'),
  blocked('generated: foreign feat -> domain client', 'libs/checkin/feat-checkin/data', `${BOOKING_CLIENT}/api`, 'scope:checkin'),
  blocked('generated: shared -> domain client', 'libs/shared/api', `${BOOKING_CLIENT}/api`, 'scope:shared'),
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
  blocked('generated: app -> domain client (no port)', 'apps/client/src/app', `${BOOKING_CLIENT}/api`, 'type:app'),
  blocked('generated: deep import into client lib', 'libs/booking/api', `${BOOKING_CLIENT}/types/src/generated/model/booking`, 'Deep import'),
  // generated testing libs: specs only, never production
  blocked('generated testing: production -> client testing', 'libs/booking/api', `${BOOKING_CLIENT}/testing`, 'non-buildable'),
  { ...blocked('generated testing: production -> client testing (tags only)', 'libs/booking/api', `${BOOKING_CLIENT}/testing`, 'type:api'), tagsOnly: true },
  blocked('generated testing: app -> shared client testing', 'apps/client/src/app', `${PET}/testing`, 'type:app'),
  allowedInSpec('generated testing: spec -> own client testing', 'libs/booking/api', `${BOOKING_CLIENT}/testing`),
  allowedInSpec('generated testing: spec -> shared client testing', 'libs/checkin/api', `${NOTIFICATION}/testing`),
  blockedInSpec('generated testing: shared spec -> domain client testing', 'libs/shared/api', `${BOOKING_CLIENT}/testing`, 'scope:shared'),
  allowed('generated testing: domain testing -> own client testing', 'libs/booking/testing', `${BOOKING_CLIENT}/testing`),
  blocked('generated testing: foreign testing -> domain client testing', 'libs/checkin/testing', `${BOOKING_CLIENT}/testing`, 'scope:checkin'),
  blocked('generated testing: testing -> client api', 'libs/booking/testing', `${BOOKING_CLIENT}/api`, 'type:testing'),
  blocked('generated testing: openapi-msw in production', 'libs/booking/api', 'openapi-msw', 'openapi-msw'),
  blocked('generated testing: faker in production', 'libs/shared/api', '@faker-js/faker', '@faker-js/faker'),
  // ... and FROM generated code (lint header: everything off except the boundary rules)
  blockedInGenerated('generated code: types -> api (same client)', 'libs/booking/generated/booking-client/types', `${BOOKING_CLIENT}/api`, [CYCLE, 'type:types']),
  blockedInGenerated('generated code: types -> core (same client)', 'libs/booking/generated/booking-client/types', `${BOOKING_CLIENT}/core`, [CYCLE, 'type:types']),
  blockedInGenerated('generated code: types -> other client api (no cycle)', 'libs/booking/generated/booking-client/types', `${PET}/api`, 'type:types'),
  blockedInGenerated('generated code: types -> @angular/core', 'libs/generated/pet-client/types', '@angular/core', '@angular/core'),
  blockedInGenerated('generated code: shared client -> domain client', 'libs/generated/pet-client/api', `${BOOKING_CLIENT}/types`, 'scope:shared'),
  blockedInGenerated('generated code: client api -> domain data', 'libs/booking/generated/booking-client/api', '@blueprint/booking/data', [CYCLE, 'type:api']),
  blockedInGenerated('generated code: client api -> events (no cycle)', 'libs/booking/generated/booking-client/api', '@blueprint/booking/events', 'type:api'),
  blockedInGenerated('generated code: deep import', 'libs/booking/generated/booking-client/api', `${BOOKING_CLIENT}/types/src/generated/model/booking`, 'Deep import'),
  blockedInGenerated('generated code: testing -> client api', 'libs/booking/generated/booking-client/testing', `${BOOKING_CLIENT}/api`, 'type:testing'),
  allowedInGenerated('generated code: api -> core', 'libs/booking/generated/booking-client/api', `${BOOKING_CLIENT}/core`),
  allowedInGenerated('generated code: api -> @angular/common/http', 'libs/generated/pet-client/api', '@angular/common/http'),
  allowedInGenerated('generated code: core -> @angular/common/http', 'libs/generated/pet-client/core', '@angular/common/http'),
  allowedInGenerated('generated code: testing -> msw, faker, openapi-msw', 'libs/generated/pet-client/testing', 'openapi-msw'),

  // new lib (only src/index.ts, created for this run): tags + constraints apply without any config
  blocked('new lib: layer rules (ui -> api)', NEW_LIB, '@blueprint/shared/api', 'type:ui'),
  blocked('new lib: own feat constraint generated', NEW_LIB, '@blueprint/booking/feat-check-booking/ui', 'feat:tmpverify'),
  allowed('new lib: -> shared', NEW_LIB, '@blueprint/shared/ui'),
  blocked('new lib: sibling feat only via feat-port', 'libs/booking/feat-check-booking/ui', NEW_LIB_ALIAS, 'feat:check-booking'),
  blocked('new lib: foreign slice only via port', 'libs/checkin/ui', NEW_LIB_ALIAS, 'scope:checkin'),
  blocked('new lib: deep alias import', 'libs/booking/utils', `${NEW_LIB_ALIAS}/src/internal`, 'Deep import'),
];

/**
 * Tag schema vs folder layout. The tags are inferred by
 * packages/tooling/src/plugin/blueprint-libs.ts, so this guards the plugin:
 * every libs/<lib>/src/index.ts must be a project and carry exactly the expected tags.
 */
function checkTagSchema(projectGraph) {
  const problems = [];
  // libs = projects with an alias; the OpenAPI client projects (libs/**/generated/<client>) have none
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
      // OpenAPI client lib: libs/generated/<client>/<part> → shared, libs/<domain>/generated/<client>/<part> → domain;
      // core is api (HTTP runtime), testing is testing; never a port/entry
      expectTag(`scope:${generatedAt === 0 ? 'shared' : scope}`);
      expectTag(`type:${{ types: 'types', api: 'api', core: 'api', testing: 'testing' }[layer] ?? `unknown part ${layer}`}`);
      expectTag('feat:none');
      expectTag('generated');
      if (tags.some((t) => ['port', 'entry', 'feat-port'].includes(t))) problems.push(`libs/${libPath}: generated lib must not be port/entry/feat-port`);
      continue;
    }
    expectTag(`scope:${scope}`);
    expectTag(`type:${['shell', 'feature'].includes(layer) ? 'feature' : layer}`);
    expectTag(featFolder ? `feat:${featFolder.slice('feat-'.length)}` : 'feat:none');
    if (layer === 'shell') expectTag('entry');
    if (layer === 'api' && scope !== 'shared') expectTag(featFolder ? 'feat-port' : 'port');
  }
  problems.push(...checkScopeList(libs));
  return { count: libs.length, problems };
}

/**
 * Scope list (nx.json → plugins → @blueprint/tooling → options.scopes): the plugin rejects libs
 * outside the list, so here only the other direction — no stale entry without any lib.
 */
function checkScopeList(libs) {
  const nxJson = JSON.parse(readFileSync('nx.json', 'utf-8'));
  const entry = nxJson.plugins?.find((plugin) => (plugin.plugin ?? plugin) === '@blueprint/tooling');
  const scopes = entry?.options?.scopes;
  if (!scopes) return ['nx.json: plugin @blueprint/tooling needs options.scopes (scope list)'];
  const usedScopes = new Set(libs.map(({ data }) => data.root.split('/')[1]));
  return scopes.filter((scope) => !usedScopes.has(scope)).map((scope) => `nx.json scopes: "${scope}" has no lib (stale entry)`);
}

/**
 * Test-only code never ships — the static layers besides the lint rules,
 * read from the project graph (targets are inferred by the plugin):
 * no build target for testing libs, specs out of the lib build tsconfig and
 * the build's `production` inputs, a `test` target exactly where specs exist,
 * no committed MSW worker (Vitest serves it from the msw package).
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
  // Vitest serves the worker of the msw package itself — no copy anywhere, least of all in an app
  const committedWorkers = execFileSync('git', ['ls-files', '*mockServiceWorker.js'], { encoding: 'utf-8' }).split('\n').filter(Boolean);
  committedWorkers.forEach((f) => problems.push(`${f}: no committed MSW worker (Vitest serves msw/mockServiceWorker.js)`));
  const appProjects = readdirSync('apps', { recursive: true }).filter((f) => f.endsWith('project.json'));
  for (const file of appProjects) {
    const text = readFileSync(join('apps', file), 'utf-8');
    if (/testing|msw/i.test(text)) problems.push(`apps/${file}: references testing/msw (assets?)`);
  }
  return { count: libs.length, problems };
}

/**
 * Libs have no config files: project, tags, targets and build files come from the plugin and the
 * ng-lib executors. Any of these below libs/ outside a src/ folder is an error — except the shared
 * libs/tsconfig*.json and a client's spec (openapi.yaml|json) in its client folder; the client options
 * live in openapi-clients.json. Runs before the temporary libs of this script exist.
 */
const LIB_CONFIG_FILE = /^(project\.json|package\.json|ng-package\.json|tsconfig.*\.json|eslint\.config\.[cm]?[jt]s|openapi\.(ya?ml|json))$/;
const SHARED_LIB_CONFIG = /^libs\/tsconfig[^/]*\.json$/;
// the committed spec of an OpenAPI client lives in the client folder (libs/[<domain>/]generated/<client>/)
const CLIENT_SPEC = /^libs\/([a-z][a-z0-9-]*\/)?generated\/[a-z][a-z0-9-]*\/openapi\.(yaml|json)$/;

function checkLibConfigFiles() {
  const files = readdirSync('libs', { recursive: true }).map((file) => join('libs', String(file)));
  const problems = files
    .filter((file) => LIB_CONFIG_FILE.test(file.split('/').at(-1)))
    .filter((file) => !SHARED_LIB_CONFIG.test(file) && !CLIENT_SPEC.test(file) && !file.split('/').includes('src'))
    .map((file) => `${file}: config file in a lib — libs have none (plugin + ng-lib executors derive them), remove it`);
  return { count: files.length, problems };
}

/**
 * Generated OpenAPI clients, from the project graph + openapi-clients.json + git:
 *   consistency  every entry ↔ client folder ↔ exactly one spec ↔ the four libs (committed index.ts =
 *                `export * from './generated'`), every client folder has an entry, the entry is a json
 *                input of generate (and not its options, which would reach every dependent's hash)
 *   graph        every part has an edge to its client project; every lib target waits for `^generate` and
 *                hashes the generated code (dependentTasksOutputFiles, transitive); generate is cached with
 *                the spec as input and src/generated as outputs; the testing lib generates before lint/typecheck
 *   git          nothing below src/generated/ is committed, every generated file is gitignored
 */
const CLIENT_PARTS = ['types', 'api', 'core', 'testing'];
const COMMITTED_INDEX = "export * from './generated';\n";

function checkGeneratedClients(projectGraph) {
  const problems = [];
  const config = JSON.parse(readFileSync('openapi-clients.json', 'utf-8'));
  const entries = config.clients ?? {};
  const nodes = Object.values(projectGraph.nodes).filter(({ data }) => data.root.startsWith('libs/'));
  const clientNodes = nodes.filter(({ data }) => data.tags?.includes('generated') && !data.metadata?.js?.packageName);
  const parts = nodes.filter(({ data }) => data.tags?.includes('generated') && data.metadata?.js?.packageName);
  const clientFolders = readdirSync('libs', { recursive: true })
    .map(String)
    .filter((path) => /^([a-z][a-z0-9-]*\/)?generated\/[a-z][a-z0-9-]*$/.test(path) && statSync(join('libs', path)).isDirectory());

  for (const folder of clientFolders) if (!entries[folder]) problems.push(`libs/${folder}: client folder without entry in openapi-clients.json`);
  for (const clientPath of Object.keys(entries)) {
    const root = `libs/${clientPath}`;
    const specs = ['openapi.yaml', 'openapi.json'].filter((file) => existsSync(join(root, file)));
    if (specs.length !== 1) problems.push(`${root}: needs exactly one spec (openapi.yaml|json), found ${specs.length}`);
    for (const part of CLIENT_PARTS) {
      const index = join(root, part, 'src/index.ts');
      if (!existsSync(index)) problems.push(`${index}: missing`);
      else if (readFileSync(index, 'utf-8') !== COMMITTED_INDEX) problems.push(`${index}: must be exactly "${COMMITTED_INDEX.trim()}"`);
    }
    const node = clientNodes.find(({ data }) => data.root === root);
    const generate = node?.data.targets?.generate;
    if (!node) {
      problems.push(`${root}: entry in openapi-clients.json, but no client project`);
      continue;
    }
    // the entry is a json input (fields) — never target options: those end up in every dependent's hash
    if (JSON.stringify(generate?.options) !== JSON.stringify({ client: clientPath })) problems.push(`${node.name}: generate options must be { client } only`);
    const entryInput = generate?.inputs?.find((input) => input.json === '{workspaceRoot}/openapi-clients.json');
    if (!entryInput?.fields?.includes(`clients.${clientPath}`)) problems.push(`${node.name}: its openapi-clients.json entry must be a generate input`);
    if (!generate?.cache) problems.push(`${node.name}: generate must be cached`);
    if (!generate?.inputs?.includes(`{workspaceRoot}/${root}/${specs[0]}`)) problems.push(`${node.name}: spec must be a generate input`);
    if (!generate?.outputs?.every((output) => output.endsWith('/src/generated'))) problems.push(`${node.name}: outputs must be the src/generated folders`);
    if (!node.data.targets?.['update-spec']) problems.push(`${node.name}: update-spec target missing`);
  }
  for (const { name, data } of parts) {
    const client = data.root.split('/').slice(0, -1).join('/');
    const clientNode = clientNodes.find((node) => node.data.root === client);
    if (!clientNode) problems.push(`${name}: no client project at ${client}`);
    // edge part → client: `^generate` reaches the client's generate, `affected` follows a spec change
    else if (!data.implicitDependencies?.includes(clientNode.name)) problems.push(`${name}: needs implicit dependency on ${clientNode.name}`);
    if (data.root.endsWith('/testing')) {
      const generate = data.targets?.generate;
      if (!generate?.cache || !generate.outputs?.includes('{projectRoot}/src/generated')) problems.push(`${name}: testing lib needs a cached generate → src/generated`);
      for (const target of ['lint', 'typecheck']) {
        if (!data.targets?.[target]?.dependsOn?.includes('generate')) problems.push(`${name}: ${target} must depend on its own generate`);
      }
    }
  }
  for (const { name, data } of nodes.filter(({ data }) => data.metadata?.js?.packageName && data.root !== UNTAGGED_LIB)) {
    for (const [target, config] of Object.entries(data.targets ?? {})) {
      if (target === 'generate') continue;
      if (!config.dependsOn?.includes('^generate')) problems.push(`${name}: ${target} must depend on ^generate`);
      // gitignored generated code is invisible to Nx hashing — the generate outputs must be an input
      if (!config.inputs?.some((input) => input.dependentTasksOutputFiles?.includes('src/generated') && input.transitive)) {
        problems.push(`${name}: ${target} must hash the generated code (dependentTasksOutputFiles, transitive)`);
      }
    }
  }
  // the app bundles the libs from dist: generated code of any (transitive) dependency must reach its hash
  for (const { name, data } of Object.values(projectGraph.nodes).filter(({ data }) => data.root.startsWith('apps/'))) {
    const build = data.targets?.build;
    if (build && !build.inputs?.some((input) => input.dependentTasksOutputFiles?.includes('src/generated') && input.transitive)) {
      problems.push(`${name}: build must hash the generated code (dependentTasksOutputFiles, transitive)`);
    }
  }
  const committed = execFileSync('git', ['ls-files', 'libs'], { encoding: 'utf-8' }).split('\n').filter((file) => file.includes('/src/generated/'));
  committed.forEach((file) => problems.push(`${file}: generated code is committed`));
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
  return { clients: clientNodes.length, entries: Object.keys(entries).length, parts: parts.length, generatedFiles: generatedFiles.length, problems };
}

/**
 * Scans the client bundle for any trace of MSW, Vitest or faker. As Nx target (`tooling:verify`) the
 * build is a dependsOn task; run directly, the script builds the client itself.
 */
function checkClientBundle() {
  const problems = [];
  const runsAsNxVerifyTarget = process.env.NX_TASK_TARGET_TARGET === 'verify';
  try {
    if (!runsAsNxVerifyTarget) execFileSync('pnpm', ['exec', 'nx', 'run', 'client:build', '--skip-nx-cache'], { stdio: 'pipe' });
  } catch (error) {
    return { problems: [`client:build failed: ${error.stderr?.toString().slice(0, 300) ?? error.message}`], files: 0 };
  }
  const distDir = 'dist/apps/client';
  const files = readdirSync(distDir, { recursive: true }).filter((f) => statSync(join(distDir, f)).isFile());
  // faker: the generated testing libs (orval mocks) must never reach the app
  const testOnlyMarkers = /\bmsw\b|mockServiceWorker|setupWorker|vitest|faker/i;
  for (const file of files) {
    if (testOnlyMarkers.test(file) || testOnlyMarkers.test(readFileSync(join(distDir, file), 'latin1'))) {
      problems.push(`${distDir}/${file}: contains msw/vitest/faker`);
    }
  }
  return { problems, files: files.length };
}

/** The real config, but without `enforceBuildableLibDependency` — isolates the tag constraints. */
async function createTagsOnlyEslint() {
  const { blueprintDepConstraints } = await import('../../../eslint.config.mjs');
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
  mkdirSync(join(NEW_TYPES_LIB, 'src'), { recursive: true });
  writeFileSync(join(NEW_TYPES_LIB, 'src/index.ts'), 'export type Probe = string;\n');
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
    const clients = checkGeneratedClients(projectGraph);
    const bundle = checkClientBundle();
    report(rows, libConfigs, schema, isolation, newLib, clients, bundle);
    const problems = [libConfigs, schema, isolation, newLib, clients, bundle].flatMap((check) => check.problems);
    process.exitCode = rows.every((r) => r.pass) && problems.length === 0 ? 0 : 1;
  } finally {
    rmSync(UNTAGGED_LIB, { recursive: true, force: true });
    rmSync(dirname(NEW_LIB), { recursive: true, force: true });
  }
}

function report(rows, libConfigs, schema, isolation, newLib, clients, bundle) {
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
  console.log(`Config-Dateien in libs/ (außer libs/tsconfig*.json): ${libConfigs.count} Dateien geprüft, ${libConfigs.problems.length} Treffer`);
  libConfigs.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`Tag-Schema + Scope-Liste: ${schema.count} Libs geprüft, ${schema.problems.length} Probleme`);
  schema.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`Test-Isolation (${isolation.count} Libs aus dem Graph: kein build für testing, Specs aus Build-tsconfig/production, test nur mit Specs, kein committeter MSW-Worker): ${isolation.problems.length} Probleme`);
  isolation.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`Neue Lib (nur ${NEW_LIB}/src/index.ts): ${newLib.problems.length ? 'NICHT ' : ''}automatisch Projekt ${JSON.stringify(newLib.actual ?? {})}`);
  newLib.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(
    `Generierte Clients: ${clients.entries} Einträge in openapi-clients.json, ${clients.clients} Client-Projekte, ${clients.parts} Libs, ` +
      `${clients.generatedFiles} generierte Dateien (alle gitignored, keine committet); Konsistenz Eintrag ↔ Ordner ↔ Spec ↔ Libs, Kanten, Targets: ${clients.problems.length} Probleme`,
  );
  clients.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`client-Bundle: ${bundle.files} Dateien auf msw/vitest/faker geprüft, ${bundle.problems.length} Treffer`);
  bundle.problems.forEach((p) => console.log(`  - ${p}`));
}

await main();
