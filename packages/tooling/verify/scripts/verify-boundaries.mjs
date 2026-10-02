#!/usr/bin/env node
/**
 * Reproducible negative + positive tests for the blueprint's Nx boundaries,
 * plus a guard that every lib carries its explicit config (project.json, tsconfig*.json, build files).
 *
 * Every case lints ONE virtual file (ESLint `lintText` with a filePath inside
 * a real lib) through the real eslint.config.mjs and asserts whether a
 * boundary rule fires. Nothing is written to the source tree except temporary
 * libs (+ their tsconfig.base.json paths), removed/restored in `finally`: an untagged
 * one (project.json with no tags) for the "noTag" case, two new ones with the files the
 * generators write (they must be tagged, constrained projects) and a bare one with only
 * src/index.ts (the config guard must report it).
 * On top, a tag-schema check guards the project.json tags against the folder layout and the scope list,
 * a test-isolation check the non-lint layers keeping test code out of
 * production, a client check the generated OpenAPI clients (openapi-clients.json ↔
 * folders ↔ specs ↔ libs, graph edges, targets, nothing committed), and a client
 * build proves the bundle carries no msw/vitest/faker; the tooling libs (packages/tooling/*) are checked for
 * name/package/tags, exports ↔ tsconfig.base.json paths, and `nx affected` reaching the users of tooling files.
 * Naming cases prove the naming rules (packages/tooling/eslint-rules, @angular-eslint) are wired into the real
 * config: a virtual file per case, the expected rule fires — or none for conforming and generated code.
 * The folder names of the libs (shape, layer, kebab-case scope/feat/client) are checked with the tag schema.
 *
 * Usage: node packages/tooling/verify/scripts/verify-boundaries.mjs   (exit 1 on any mismatch)
 */
import { createProjectGraphAsync } from '@nx/devkit';
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const workspaceRoot = join(import.meta.dirname, '../../../..');
process.chdir(workspaceRoot);
process.env.NX_DAEMON ??= 'false';

const BOUNDARY_RULES = ['@nx/enforce-module-boundaries', 'no-restricted-imports'];
const UNTAGGED_LIB = 'libs/tmp-verify-untagged';
// a new lib with the config files the generators write — a tagged, constrained project.
// It lives in a new feat of a known scope: a new scope would need an entry in the scope list (lib-scopes.json).
const NEW_LIB = 'libs/booking/feat-tmpverify/ui';
const NEW_LIB_ALIAS = '@blueprint/booking/feat-tmpverify/ui';
// second temporary lib in the same feat: a types lib of the booking scope besides booking/types
const NEW_TYPES_LIB = 'libs/booking/feat-tmpverify/types';
const NEW_LIB_EXPECTED = { name: 'booking-feat-tmpverify-ui', tags: ['npm:private', 'scope:booking', 'type:ui', 'feat:tmpverify'], targets: ['build', 'lint', 'typecheck'] };
// a lib without any config file (only src/index.ts): the config guard must report it
const BARE_LIB = 'libs/booking/feat-tmpverify/state';
const SCOPES_FILE = 'lib-scopes.json';
const BASE_TSCONFIG = 'tsconfig.base.json';
const CYCLE = 'Circular dependency';

// generated OpenAPI clients (packages/tooling/openapi): two shared, one domain-owned
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
  blocked('layer: ui -> state', 'libs/booking/ui', '@blueprint/booking/state', 'type:ui'),
  blocked('layer: ui -> api', 'libs/booking/ui', '@blueprint/booking/api', 'type:ui'),
  blocked('layer: utils -> api (in shared)', 'libs/shared/utils', '@blueprint/shared/api', 'type:utils'),
  allowed('layer: types -> types (shared)', 'libs/booking/types', '@blueprint/shared/types'),
  allowed('layer: types -> types (own scope)', NEW_TYPES_LIB, '@blueprint/booking/types'),
  blocked('layer: types -> utils', 'libs/booking/types', '@blueprint/shared/utils', 'type:types'),
  blocked('layer: types -> foreign domain types', 'libs/booking/types', '@blueprint/checkin/types', 'scope:booking'),
  blocked('layer: shared types -> domain types', 'libs/shared/types', '@blueprint/booking/types', 'scope:shared'),
  blocked('layer: events -> state', 'libs/booking/events', '@blueprint/booking/state', ['type:events', CYCLE]),
  blocked('layer: api -> state', 'libs/booking/api', '@blueprint/booking/state', ['type:api', CYCLE]),
  // without a cycle the layer constraint itself answers (type axis is checked before scope)
  blocked('layer: events -> state (no cycle)', 'libs/booking/events', '@blueprint/auth/state', 'type:events'),
  blocked('layer: api -> state (no cycle)', 'libs/booking/api', '@blueprint/auth/state', 'type:api'),
  blocked('layer: state -> ui', 'libs/booking/state', '@blueprint/booking/ui', 'type:state'),
  allowed('layer: ui -> events', 'libs/booking/ui', '@blueprint/booking/events'),
  allowed('layer: state -> api', 'libs/booking/state', '@blueprint/booking/api'),
  allowed('layer: feature -> state/ui', 'libs/booking/feat-check-booking/feature', '@blueprint/booking/ui'),

  // scope axis (domains + shared features)
  blocked('scope: foreign domain internals', 'libs/checkin/state', '@blueprint/booking/state', 'scope:checkin'),
  allowed('scope: foreign domain via port', 'libs/checkin/state', '@blueprint/booking/api'),
  blocked('scope: shared-feature internals', 'libs/checkin/feat-checkin/feature', '@blueprint/auth/state', 'scope:checkin'),
  allowed('scope: shared-feature via port', 'libs/checkin/feat-checkin/feature', '@blueprint/auth/api'),
  blocked('scope: foreign entry', 'libs/booking/shell', '@blueprint/checkin/shell', 'scope:booking'),
  blocked('scope: shared -> domain', 'libs/shared/utils', '@blueprint/checkin/utils', 'scope:shared'),
  allowed('scope: domain -> shared', 'libs/booking/utils', '@blueprint/shared/utils'),

  // feat isolation
  blocked('feat: sibling feat internals', 'libs/checkin/feat-history/feature', '@blueprint/checkin/feat-checkin/state', 'feat:history'),
  blocked('feat: sibling feat container', 'libs/booking/feat-manage-booking/feature', '@blueprint/booking/feat-check-booking/feature', 'feat:manage-booking'),
  allowed('feat: sibling via feat-port', 'libs/checkin/feat-history/feature', '@blueprint/checkin/feat-checkin/api'),
  blocked('feat: foreign feat-port', 'libs/booking/feat-manage-booking/feature', '@blueprint/checkin/feat-checkin/api', 'scope:booking'),
  allowed('feat: own feat internals', 'libs/booking/feat-check-booking/feature', '@blueprint/booking/feat-check-booking/state'),
  allowed('feat: domain-shared from feat', 'libs/booking/feat-check-booking/state', '@blueprint/booking/state'),

  // app isolation / app shell
  blocked('app: shell -> slice internals', 'apps/client/src/app', '@blueprint/booking/ui', 'type:app'),
  blocked('app: shell -> state', 'apps/client/src/app', '@blueprint/booking/state', 'type:app'),
  allowed('app: shell -> entry', 'apps/client/src/app', '@blueprint/layout/shell'),
  blocked('app: static import of lazy entry', 'apps/client/src/app', '@blueprint/booking/shell', 'lazy-loaded'),
  allowed('app: shell -> port', 'apps/client/src/app', '@blueprint/booking/api'),
  blocked('app: lib -> app', 'libs/booking/utils', 'apps/client/src/app/app', 'Projects cannot be imported by a relative or absolute path'),

  // encapsulation (public API = index.ts)
  blocked('encapsulation: relative into foreign lib', 'libs/checkin/ui', '../../state/src/internal/checkin.mapper', 'Projects cannot be imported by a relative or absolute path'),
  blocked('encapsulation: deep alias import', 'libs/checkin/feat-checkin/state', '@blueprint/checkin/state/src/internal/checkin.mapper', 'Deep import'),

  // Nx-only extras
  blocked('nx: http only in api', 'libs/booking/ui', '@angular/common/http', '@angular/common/http'),
  allowed('nx: http in api', 'libs/booking/api', '@angular/common/http'),
  blocked('nx: types framework-free', 'libs/booking/types', '@angular/core', '@angular/core'),
  blocked('nx: no cycles', 'libs/booking/state', '@blueprint/booking/feat-check-booking/state', CYCLE),
  blocked('nx: untagged lib (noTag)', UNTAGGED_LIB, '@blueprint/shared/utils', 'without tags'),

  // testing: test-only libs never reach production code
  // buildable lib -> non-buildable testing lib: `enforceBuildableLibDependency` answers first ...
  blocked('testing: production -> testing', 'libs/booking/state', '@blueprint/booking/testing', 'non-buildable'),
  blocked('testing: feature -> testing', 'libs/booking/feat-check-booking/feature', '@blueprint/booking/testing', 'non-buildable'),
  // ... the tag constraints block it on their own, too (buildable check switched off)
  { ...blocked('testing: production -> testing (tags only)', 'libs/booking/state', '@blueprint/booking/testing', 'type:state'), tagsOnly: true },
  { ...blocked('testing: feature -> testing (tags only)', 'libs/booking/feat-check-booking/feature', '@blueprint/booking/testing', 'type:feature'), tagsOnly: true },
  blocked('testing: app -> shared/testing', 'apps/client/src/app', '@blueprint/shared/testing', 'type:app'),
  allowedInSpec('testing: spec -> own testing', 'libs/booking/state', '@blueprint/booking/testing'),
  allowedInSpec('testing: spec -> foreign domain testing', 'libs/checkin/feat-checkin/feature', '@blueprint/booking/testing'),
  allowedInSpec('testing: spec -> shared/testing', 'libs/shared/api', '@blueprint/shared/testing'),
  blockedInSpec('testing: shared spec -> domain testing', 'libs/shared/api', '@blueprint/booking/testing', 'scope:shared'),
  blockedInSpec('testing: spec keeps layer rules (ui -> state)', 'libs/booking/ui', '@blueprint/booking/state', 'type:ui'),
  blockedInSpec('testing: types spec -> testing (cycle)', 'libs/booking/types', '@blueprint/booking/testing', [CYCLE, 'type:types']),
  // booking/state has specs against booking/testing: the edge back is a cycle
  blocked('testing: testing -> state', 'libs/booking/testing', '@blueprint/booking/state', [CYCLE, 'type:testing']),
  blocked('testing: testing -> state (no cycle)', 'libs/booking/testing', '@blueprint/auth/state', 'type:testing'),
  blocked('testing: testing -> api (port)', 'libs/booking/testing', '@blueprint/booking/api', 'type:testing'),
  blocked('testing: testing -> foreign domain testing', 'libs/checkin/testing', '@blueprint/booking/testing', 'scope:checkin'),
  allowed('testing: testing -> types', 'libs/booking/testing', '@blueprint/booking/types'),
  allowed('testing: testing -> shared/testing', 'libs/booking/testing', '@blueprint/shared/testing'),
  blocked('testing: msw in production', 'libs/booking/api', 'msw', 'msw'),
  blocked('testing: msw/browser in production', 'libs/booking/state', 'msw/browser', 'msw/browser'),
  blocked('testing: vitest in production', 'libs/booking/ui', 'vitest', 'vitest'),
  blocked('testing: @vitest/* in app', 'apps/client/src/app', '@vitest/browser-playwright', '@vitest/browser-playwright'),
  allowed('testing: msw in testing lib', 'libs/booking/testing', 'msw'),
  allowedInSpec('testing: msw + vitest in spec', 'libs/booking/state', 'msw'),

  // generated clients: services + core = type:api, models = type:types, testing = type:testing; scope from the folder
  allowed('generated: domain port -> own client api', 'libs/booking/api', `${BOOKING_CLIENT}/api`),
  allowed('generated: domain port -> own client types', 'libs/booking/api', `${BOOKING_CLIENT}/types`),
  allowed('generated: domain port -> own client core', 'libs/booking/api', `${BOOKING_CLIENT}/core`),
  allowed('generated: domain port -> shared client api', 'libs/checkin/api', `${NOTIFICATION}/api`),
  allowed('generated: shared api -> shared client api', 'libs/shared/api', `${PET}/api`),
  blocked('generated: foreign domain -> domain client api', 'libs/checkin/api', `${BOOKING_CLIENT}/api`, 'scope:checkin'),
  blocked('generated: foreign domain -> domain client types', 'libs/checkin/types', `${BOOKING_CLIENT}/types`, 'scope:checkin'),
  blocked('generated: foreign feat -> domain client', 'libs/checkin/feat-checkin/state', `${BOOKING_CLIENT}/api`, 'scope:checkin'),
  blocked('generated: shared -> domain client', 'libs/shared/api', `${BOOKING_CLIENT}/api`, 'scope:shared'),
  blocked('generated: ui -> client api', 'libs/booking/ui', `${BOOKING_CLIENT}/api`, 'type:ui'),
  blocked('generated: ui -> client core', 'libs/booking/ui', `${BOOKING_CLIENT}/core`, 'type:ui'),
  blocked('generated: shared ui -> shared client api', 'libs/shared/ui', `${PET}/api`, 'type:ui'),
  allowed('generated: ui -> client types', 'libs/booking/ui', `${BOOKING_CLIENT}/types`),
  allowed('generated: state -> client api (matrix)', 'libs/booking/state', `${BOOKING_CLIENT}/api`),
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
  blockedInGenerated('generated code: client api -> domain state', 'libs/booking/generated/booking-client/api', '@blueprint/booking/state', [CYCLE, 'type:api']),
  blockedInGenerated('generated code: client api -> events (no cycle)', 'libs/booking/generated/booking-client/api', '@blueprint/booking/events', 'type:api'),
  blockedInGenerated('generated code: deep import', 'libs/booking/generated/booking-client/api', `${BOOKING_CLIENT}/types/src/generated/model/booking`, 'Deep import'),
  blockedInGenerated('generated code: testing -> client api', 'libs/booking/generated/booking-client/testing', `${BOOKING_CLIENT}/api`, 'type:testing'),
  allowedInGenerated('generated code: api -> core', 'libs/booking/generated/booking-client/api', `${BOOKING_CLIENT}/core`),
  allowedInGenerated('generated code: api -> @angular/common/http', 'libs/generated/pet-client/api', '@angular/common/http'),
  allowedInGenerated('generated code: core -> @angular/common/http', 'libs/generated/pet-client/core', '@angular/common/http'),
  allowedInGenerated('generated code: testing -> msw, faker, openapi-msw', 'libs/generated/pet-client/testing', 'openapi-msw'),

  // tooling libs (packages/tooling/<lib>): explicit, acyclic package imports (conventions ← openapi ← workspace → ng-lib)
  allowed('tooling: openapi -> conventions', 'packages/tooling/openapi', '@blueprint/tooling-conventions'),
  allowed('tooling: openapi -> conventions/tree', 'packages/tooling/openapi', '@blueprint/tooling-conventions/tree'),
  allowed('tooling: workspace -> conventions', 'packages/tooling/workspace', '@blueprint/tooling-conventions'),
  allowed('tooling: workspace -> openapi/clients', 'packages/tooling/workspace', '@blueprint/tooling-openapi/clients'),
  allowedInSpec('tooling: spec -> conventions/testing', 'packages/tooling/openapi', '@blueprint/tooling-conventions/testing'),
  blocked('tooling: conventions -> openapi', 'packages/tooling/conventions', '@blueprint/tooling-openapi', [CYCLE, 'tooling:conventions']),
  // ng-lib and workspace export nothing to import (executor / generators only) — a module of theirs stands for "reuse it"
  blocked('tooling: conventions -> ng-lib', 'packages/tooling/conventions', '@blueprint/tooling-ng-lib/src/test.js', 'tooling:conventions'),
  blocked('tooling: openapi -> workspace', 'packages/tooling/openapi', '@blueprint/tooling-workspace/package.json', [CYCLE, 'tooling:openapi']),
  blocked('tooling: openapi -> ng-lib', 'packages/tooling/openapi', '@blueprint/tooling-ng-lib/src/test.js', 'tooling:openapi'),
  blocked('tooling: ng-lib -> openapi', 'packages/tooling/ng-lib', '@blueprint/tooling-openapi', 'tooling:ng-lib'),
  blocked('tooling: ng-lib -> conventions', 'packages/tooling/ng-lib', '@blueprint/tooling-conventions', 'tooling:ng-lib'),
  blocked('tooling: verify -> workspace', 'packages/tooling/verify', '@blueprint/tooling-workspace/package.json', 'tooling:verify'),
  blocked('tooling: workspace -> ng-lib (no longer needed)', 'packages/tooling/workspace', '@blueprint/tooling-ng-lib/src/test.js', 'tooling:workspace'),
  allowed('tooling: eslint-rules -> conventions', 'packages/tooling/eslint-rules', '@blueprint/tooling-conventions'),
  blocked('tooling: eslint-rules -> workspace', 'packages/tooling/eslint-rules', '@blueprint/tooling-workspace/package.json', 'tooling:eslint-rules'),
  blockedInSpec('tooling: conventions spec -> openapi', 'packages/tooling/conventions', '@blueprint/tooling-openapi', [CYCLE, 'tooling:conventions']),
  blocked('tooling: relative across tooling libs', 'packages/tooling/workspace', '../../conventions/src/lib-conventions', 'Projects cannot be imported by a relative or absolute path'),
  blocked('tooling: tooling -> lib', 'packages/tooling/openapi', '@blueprint/shared/api', 'type:tooling'),
  blocked('tooling: lib -> tooling', 'libs/booking/state', '@blueprint/tooling-conventions', 'non-buildable'),
  { ...blocked('tooling: lib -> tooling (tags only)', 'libs/booking/state', '@blueprint/tooling-conventions', 'type:state'), tagsOnly: true },

  // new lib (created for this run with the generators' files): tags + constraints apply
  blocked('new lib: layer rules (ui -> api)', NEW_LIB, '@blueprint/shared/api', 'type:ui'),
  blocked('new lib: own feat constraint generated', NEW_LIB, '@blueprint/booking/feat-check-booking/ui', 'feat:tmpverify'),
  allowed('new lib: -> shared', NEW_LIB, '@blueprint/shared/ui'),
  blocked('new lib: sibling feat only via feat-port', 'libs/booking/feat-check-booking/ui', NEW_LIB_ALIAS, 'feat:check-booking'),
  blocked('new lib: foreign slice only via port', 'libs/checkin/ui', NEW_LIB_ALIAS, 'scope:checkin'),
  blocked('new lib: deep alias import', 'libs/booking/utils', `${NEW_LIB_ALIAS}/src/internal`, 'Deep import'),
];

/**
 * Naming scheme (docs/nx-umsetzung.md → Namensschema): the rule logic is covered by the RuleTester specs of
 * tooling-eslint-rules; these cases prove the wiring in the real eslint.config.mjs — loader, files/ignores,
 * options (selector prefix) — incl. the exclusion of generated code. `file` may be an existing file:
 * only its virtual content is linted.
 */
const NAMING_RULES = [
  'blueprint/lib-file-naming',
  'blueprint/layer-symbol-naming',
  'blueprint/no-internal-export',
  '@angular-eslint/component-selector',
  '@typescript-eslint/naming-convention',
];
const component = (selector, className) =>
  `import { Component } from '@angular/core';\n@Component({ selector: '${selector}', template: '' })\nexport class ${className} {}\n`;
const naming = (rule, file, code, expectedRule, expectedText) => ({ rule, file, code, expectedRule, expectedText, allowed: !expectedRule });

const namingCases = [
  naming('naming: .store.ts outside state/ui/feature', 'libs/booking/utils/src/tmp-verify.store.ts', 'export class TmpVerifyStore {}\n', 'blueprint/lib-file-naming', 'belongs into a state/ui/feature lib'),
  naming('naming: plain file in a slice types lib', 'libs/booking/types/src/tmp-verify.ts', 'export type TmpVerify = string;\n', 'blueprint/lib-file-naming', 'carry their kind'),
  naming('naming: folder not kebab-case', 'libs/booking/ui/src/TmpVerify/tmp-verify.ts', 'export const tmpVerify = 1;\n', 'blueprint/lib-file-naming', 'must be kebab-case'),
  naming('naming: store class ↔ file', 'libs/booking/state/src/tmp-verify.store.ts', 'export class Bookings {}\n', 'blueprint/layer-symbol-naming', '"TmpVerifyStore"'),
  naming('naming: feat container ↔ feat', 'libs/checkin/feat-history/feature/src/feat-history.ts', component('app-feat-history', 'HistoryPage'), 'blueprint/layer-symbol-naming', '"FeatHistory"'),
  naming('naming: routes export ↔ scope', 'libs/booking/shell/src/booking.routes.ts', 'export const routes = [];\n', 'blueprint/layer-symbol-naming', '"bookingRoutes"'),
  naming('naming: component selector ↔ file', 'libs/booking/ui/src/tmp-verify.ts', component('app-other', 'TmpVerify'), 'blueprint/layer-symbol-naming', '"app-tmp-verify"'),
  naming('naming: component selector prefix', 'libs/booking/ui/src/tmp-verify.ts', component('bk-tmp-verify', 'TmpVerify'), '@angular-eslint/component-selector', 'prefix'),
  naming('naming: internal/ in public API', 'libs/checkin/state/src/index.ts', "export * from './internal/checkin.mapper';\n", 'blueprint/no-internal-export', 'internal/ is lib-private'),
  naming('naming: casing (class)', 'libs/booking/state/src/tmp-verify.ts', 'export class tmp_verify {}\n', '@typescript-eslint/naming-convention', 'PascalCase'),
  naming('naming: conforming names', 'libs/booking/state/src/tmp-verify.store.ts', 'export class TmpVerifyStore {}\n'),
  naming('naming: conforming component', 'libs/booking/ui/src/tmp-verify.ts', component('app-tmp-verify', 'TmpVerify')),
  naming('naming: src/generated/** excluded', 'libs/booking/types/src/generated/model/tmp_verify.ts', 'export class tmp_verify {}\n'),
  naming('naming: generated client lib excluded', 'libs/generated/pet-client/api/src/tmp-verify.store.ts', 'export class Whatever {}\n'),
];

async function lintNamingCase({ file, code }, eslint) {
  const [result] = await eslint.lintText(code, { filePath: join(workspaceRoot, file) });
  return result.messages.filter((m) => NAMING_RULES.includes(m.ruleId));
}

/** A lib = folder below libs/ with src/index.ts (client folders libs/[<domain>/]generated/<client> have none). */
const isLibRoot = (root) => root.startsWith('libs/') && existsSync(join(root, 'src/index.ts'));
const libNodesOf = (projectGraph) =>
  Object.values(projectGraph.nodes).filter(({ data }) => isLibRoot(data.root) && data.root !== UNTAGGED_LIB);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf-8'));
const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item));

/**
 * Tags a lib must carry, derived independently from its path (not from the conventions code the generators use):
 * scope/type/feat + entry/port/feat-port; generated client parts: scope of the placement, type of the part, `generated`.
 */
function expectedTags(libPath) {
  const [scope, ...rest] = libPath.split('/');
  const layer = rest.at(-1);
  const generatedAt = libPath.split('/').indexOf('generated');
  if (generatedAt !== -1) {
    // OpenAPI client lib: libs/generated/<client>/<part> → shared, libs/<domain>/generated/<client>/<part> → domain;
    // core is api (HTTP runtime), testing is testing; never a port/entry
    const type = { types: 'types', api: 'api', core: 'api', testing: 'testing' }[layer] ?? `unknown part ${layer}`;
    return [`scope:${generatedAt === 0 ? 'shared' : scope}`, `type:${type}`, 'feat:none', 'generated'];
  }
  const featFolder = rest.find((segment) => segment.startsWith('feat-'));
  const tags = [
    `scope:${scope}`,
    `type:${['shell', 'feature'].includes(layer) ? 'feature' : layer}`,
    featFolder ? `feat:${featFolder.slice('feat-'.length)}` : 'feat:none',
  ];
  if (layer === 'shell') tags.push('entry');
  if (layer === 'api' && scope !== 'shared') tags.push(featFolder ? 'feat-port' : 'port');
  return tags;
}

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const LAYERS = ['types', 'utils', 'events', 'api', 'state', 'ui', 'shell', 'feature', 'testing'];

/**
 * Folder rule of a lib path (below libs/), derived independently like the tags (mirrors `libPathError` of
 * tooling-conventions, which the generators apply): shape <scope>/<layer> | <scope>/feat-<feat>/<layer> |
 * [<domain>/]generated/<client>/<part>, a known layer/part, scope/feat/client in kebab-case — the folder names
 * become project names, aliases and tags. No plugin rejects a hand-made lib here, so this check does.
 */
function folderError(libPath) {
  const segments = libPath.split('/');
  const generatedAt = segments.indexOf('generated');
  let names;
  if (generatedAt !== -1) {
    const validShape = (generatedAt === 0 && segments.length === 3) || (generatedAt === 1 && segments.length === 4);
    if (!validShape || !CLIENT_PARTS.includes(segments.at(-1))) {
      return `libs/${libPath}: not a generated client lib — expected libs/[<domain>/]generated/<client>/<part>, part one of ${CLIENT_PARTS.join(', ')}`;
    }
    names = segments.slice(0, -1).filter((segment) => segment !== 'generated');
  } else {
    const [scope, ...rest] = segments;
    const validShape = rest.length === 1 || (rest.length === 2 && rest[0].startsWith('feat-'));
    if (!scope || !validShape || !LAYERS.includes(rest.at(-1))) {
      return `libs/${libPath}: not a blueprint lib path — expected libs/<scope>/<layer> or libs/<scope>/feat-<feat>/<layer>, layer one of ${LAYERS.join(', ')}`;
    }
    names = rest.length === 2 ? [scope, rest[0].slice('feat-'.length)] : [scope];
  }
  const notKebab = names.find((name) => !KEBAB_CASE.test(name));
  return notKebab === undefined ? undefined : `libs/${libPath}: folder "${notKebab}" must be kebab-case (e.g. "check-booking")`;
}

/**
 * Tag schema vs folder layout: the tags in every lib's project.json must be exactly the ones its path implies
 * (a typo in a tag would silently create a new scope/feat), every libs/<lib>/src/index.ts must be a project,
 * its scope must be in the scope list (a typo in a folder name), its folders must follow the folder rule
 * (shape, layer, kebab-case) — this replaces the former plugin's guard.
 */
function checkTagSchema(projectGraph) {
  const problems = [];
  const libs = libNodesOf(projectGraph);
  const markerRoots = readdirSync('libs', { recursive: true })
    .filter((f) => f.endsWith('src/index.ts'))
    .map((f) => join('libs', dirname(dirname(f))));
  for (const root of markerRoots) {
    if (root !== BARE_LIB && !libs.some((node) => node.data.root === root)) problems.push(`${root}: has src/index.ts but is no project`);
  }
  const scopes = readScopes();
  for (const { data } of libs) {
    const libPath = data.root.slice('libs/'.length);
    const pathError = folderError(libPath);
    if (pathError) problems.push(pathError);
    const expected = expectedTags(libPath);
    const { tags = [] } = readJson(join(data.root, 'project.json'));
    if (!sameSet(tags, expected)) problems.push(`${data.root}/project.json: tags ${JSON.stringify(tags)}, path implies ${JSON.stringify(expected)}`);
    const scope = expected[0].slice('scope:'.length);
    if (scopes && !scopes.includes(scope)) problems.push(`${data.root}: scope "${scope}" is not in ${SCOPES_FILE} (${scopes.join(', ')}) — folder typo? New slice: nx g @blueprint/tooling-workspace:domain ${scope}`);
  }
  problems.push(...checkScopeList(libs, scopes));
  return { count: libs.length, problems };
}

const readScopes = () => (existsSync(SCOPES_FILE) ? readJson(SCOPES_FILE).scopes : undefined);

/** Scope list (lib-scopes.json): must exist, no stale entry without any lib. */
function checkScopeList(libs, scopes) {
  if (!Array.isArray(scopes)) return [`${SCOPES_FILE}: needs { "scopes": [...] } (scope list)`];
  const usedScopes = new Set(libs.map(({ data }) => expectedTags(data.root.slice('libs/'.length))[0].slice('scope:'.length)));
  return scopes.filter((scope) => !usedScopes.has(scope)).map((scope) => `${SCOPES_FILE}: "${scope}" has no lib (stale entry)`);
}

/**
 * Test-only code never ships — the static layers besides the lint rules,
 * read from the project graph (project.json + nx.json targetDefaults):
 * no build target for testing libs, specs out of the lib build tsconfig and
 * the build's `production` inputs, a `test` target exactly where specs exist (the only test target:
 * cached, headless, one-shot — the Vitest UI is `test --ui`),
 * no committed MSW worker (Vitest serves it from the msw package).
 */
function checkTestIsolation(projectGraph) {
  const problems = [];
  const production = JSON.parse(readFileSync('nx.json', 'utf-8')).namedInputs.production;
  if (!production.includes('!{projectRoot}/**/*.spec.ts')) problems.push('nx.json: production input must exclude specs');
  const libs = libNodesOf(projectGraph);
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
    // one test target: Vitest UI is `test --ui` (ng-lib executor + hasher), the target itself stays headless, one-shot, cached
    const extraTestTargets = Object.keys(targets).filter((name) => name.startsWith('test-') || name.startsWith('test:'));
    if (extraTestTargets.length) problems.push(`${root}: only one test target, found ${extraTestTargets.join(', ')}`);
    const test = targets.test;
    if (test && (test.cache !== true || test.options?.ui || test.options?.watch !== false || !test.options?.browsers?.every((b) => b.endsWith('Headless')))) {
      problems.push(`${root}: test must be cached, headless, watch: false, without ui`);
    }
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
 * Explicit config per lib (the generators write it, nothing infers it). Every lib (libs/**\/src/index.ts) has:
 *   project.json, tsconfig.json                                  always
 *   package.json, ng-package.json, tsconfig.lib(.prod).json      buildable libs — never testing libs
 *   tsconfig.spec.json                                           exactly when src/ has specs
 * with the path-dependent values right (name, sourceRoot, targets, alias, dist folder, relative extends),
 * peerDependencies = npm packages of the production code (not for generated client parts: gitignored code),
 * and exactly one tsconfig.base.json paths entry (no wildcard, no stale entry). Config files anywhere else
 * below libs/ are errors (a client folder holds only its project.json + spec).
 */
const LIB_CONFIG_FILE = /^(project\.json|package\.json|ng-package\.json|tsconfig.*\.json|eslint\.config\.[cm]?[jt]s|openapi\.(ya?ml|json))$/;
const BUILD_FILES = ['package.json', 'ng-package.json', 'tsconfig.lib.json', 'tsconfig.lib.prod.json'];
// the client folder (libs/[<domain>/]generated/<client>/) holds the committed spec + the client project.json
const CLIENT_FOLDER_FILE = /^libs\/([a-z][a-z0-9-]*\/)?generated\/[a-z][a-z0-9-]*\/(openapi\.(yaml|json)|project\.json)$/;

const hasSpecFiles = (root) => readdirSync(join(root, 'src'), { recursive: true }).some((f) => String(f).endsWith('.spec.ts'));
const offsetOf = (root) => '../'.repeat(root.split('/').length);

/** npm packages the production code (src/ without specs) imports, as ^<major>.0.0 of the root package.json. */
function expectedPeerDependencies(root) {
  const manifest = readJson('package.json');
  const versions = { ...manifest.devDependencies, ...manifest.dependencies };
  const peers = {};
  const files = readdirSync(join(root, 'src'), { recursive: true }).map(String).filter((f) => f.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(f));
  for (const file of files) {
    for (const { fileName } of ts.preProcessFile(readFileSync(join(root, 'src', file), 'utf-8'), true, true).importedFiles) {
      const name = fileName.split('/').slice(0, fileName.startsWith('@') ? 2 : 1).join('/');
      const major = /\d+/.exec(versions[name] ?? '')?.[0];
      if (!fileName.startsWith('.') && !fileName.startsWith('@blueprint/') && name !== 'tslib' && major) peers[name] = `^${major}.0.0`;
    }
  }
  return Object.fromEntries(Object.entries(peers).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function checkLibConfig(root, paths) {
  const problems = [];
  const problem = (file, text) => problems.push(`${root}/${file}: ${text}`);
  const libPath = root.slice('libs/'.length);
  const alias = `@blueprint/${libPath}`;
  const offset = offsetOf(root);
  const testing = expectedTags(libPath).includes('type:testing');
  const generated = libPath.split('/').includes('generated');
  const specs = hasSpecFiles(root);
  const required = ['project.json', 'tsconfig.json', ...(testing ? [] : BUILD_FILES), ...(specs ? ['tsconfig.spec.json'] : [])];
  const forbidden = [...(testing ? BUILD_FILES : []), ...(specs ? [] : ['tsconfig.spec.json'])];
  for (const file of required) if (!existsSync(join(root, file))) problem(file, `missing (${testing ? 'testing lib' : 'buildable lib'}${specs ? ' with specs' : ''}) — the generators write it`);
  for (const file of forbidden) if (existsSync(join(root, file))) problem(file, testing ? 'a testing lib is never built' : 'no specs, no spec config');
  if (JSON.stringify(paths[alias]) !== JSON.stringify([`./${root}/src/index.ts`])) {
    problems.push(`${BASE_TSCONFIG} paths["${alias}"]: expected ["./${root}/src/index.ts"], got ${JSON.stringify(paths[alias] ?? 'none')}`);
  }
  const check = (file, verify) => existsSync(join(root, file)) && verify(readJson(join(root, file)));
  check('project.json', (project) => {
    const name = libPath.replaceAll('/', '-');
    if (project.name !== name) problem('project.json', `name must be "${name}"`);
    if (project.sourceRoot !== `${root}/src`) problem('project.json', `sourceRoot must be "${root}/src"`);
    const targets = Object.keys(project.targets ?? {}).sort();
    const expected = [...(testing ? [] : ['build']), 'lint', 'typecheck', ...(specs ? ['test'] : []), ...(generated && testing ? ['generate'] : [])].sort();
    if (!sameSet(targets, expected)) problem('project.json', `targets ${JSON.stringify(targets)}, expected ${JSON.stringify(expected)}`);
  });
  check('tsconfig.json', (tsconfig) => {
    if (tsconfig.extends !== `${offset}tsconfig.base.json`) problem('tsconfig.json', `must extend ${offset}tsconfig.base.json`);
    if (!tsconfig.include?.includes('src/**/*.ts')) problem('tsconfig.json', 'must include src/**/*.ts');
  });
  check('package.json', (manifest) => {
    if (manifest.name !== alias) problem('package.json', `name must be the alias "${alias}" (Nx maps it to dist when the app builds against the libs)`);
    if (manifest.private !== true) problem('package.json', 'must be private (full compilation, not publishable)');
    const peers = manifest.peerDependencies ?? {};
    const expected = generated ? {} : expectedPeerDependencies(root);
    if (JSON.stringify(peers) !== JSON.stringify(expected)) problem('package.json', `peerDependencies ${JSON.stringify(peers)}, production code imports ${JSON.stringify(expected)}`);
  });
  check('ng-package.json', (ngPackage) => {
    if (ngPackage.dest !== `${offset}dist/${root}`) problem('ng-package.json', `dest must be ${offset}dist/${root}`);
    if (ngPackage.lib?.entryFile !== 'src/index.ts') problem('ng-package.json', 'lib.entryFile must be src/index.ts');
  });
  check('tsconfig.lib.json', (tsconfig) => {
    if (tsconfig.extends !== './tsconfig.json') problem('tsconfig.lib.json', 'must extend ./tsconfig.json');
  });
  check('tsconfig.lib.prod.json', (tsconfig) => {
    if (tsconfig.extends !== './tsconfig.lib.json') problem('tsconfig.lib.prod.json', 'must extend ./tsconfig.lib.json');
  });
  check('tsconfig.spec.json', (tsconfig) => {
    if (tsconfig.extends !== './tsconfig.json') problem('tsconfig.spec.json', 'must extend ./tsconfig.json');
  });
  return problems;
}

function checkLibConfigFiles(libRoots = undefined) {
  const files = readdirSync('libs', { recursive: true }).map((file) => join('libs', String(file)));
  const roots = libRoots ?? files.filter((file) => file.endsWith('/src/index.ts')).map((file) => dirname(dirname(file)));
  const { paths } = readJson(BASE_TSCONFIG).compilerOptions;
  const problems = roots.flatMap((root) => checkLibConfig(root, paths));
  if (libRoots) return { count: roots.length, problems };
  // config files outside a lib (or a client folder), e.g. a leftover libs/tsconfig.json or a lib without src/index.ts
  problems.push(
    ...files
      .filter((file) => LIB_CONFIG_FILE.test(file.split('/').at(-1)) && !file.split('/').includes('src'))
      .filter((file) => !roots.includes(dirname(file)) && !CLIENT_FOLDER_FILE.test(file))
      .map((file) => `${file}: config file outside a lib (no src/index.ts next to it) or client folder`),
  );
  // paths: one exact entry per lib — no wildcard, no entry for a lib that does not exist (anymore)
  for (const [alias, targets] of Object.entries(paths)) {
    if (alias.includes('*')) problems.push(`${BASE_TSCONFIG} paths["${alias}"]: no wildcard — one exact entry per lib`);
    const target = targets[0]?.replace(/^\.\//, '');
    if (target?.startsWith('libs/') && !roots.includes(dirname(dirname(target)))) problems.push(`${BASE_TSCONFIG} paths["${alias}"]: no lib at ${target} (stale entry)`);
  }
  return { count: roots.length, problems };
}

/**
 * Generated OpenAPI clients, from the project graph + openapi-clients.json + git:
 *   consistency  every entry ↔ client folder ↔ exactly one spec ↔ the four libs (committed index.ts =
 *                `export * from './generated'`), every client folder has an entry, the entry is a json
 *                input of generate (and not its options, which would reach every dependent's hash),
 *                the adapter's cache inputs in project.json match the entry's adapter
 *   graph        every part has its edges (client, parts below); every lib target waits for `^generate` and
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
  const clientNodes = nodes.filter(({ data }) => data.tags?.includes('generated') && !isLibRoot(data.root));
  const parts = nodes.filter(({ data }) => data.tags?.includes('generated') && isLibRoot(data.root));
  const registry = readJson('packages/tooling/openapi/src/facade/adapters/registry.json');
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
    // project.json holds the adapter's cache inputs (registry.json) — an adapter switch in openapi-clients.json
    // needs them, too (and the testing lib's generate never depends on the adapter)
    const adapter = entries[clientPath].adapter ?? config.defaultAdapter ?? 'openapi-tools';
    const registration = registry[adapter];
    const adapterInputs = registration && [
      ...registration.inputs,
      { externalDependencies: [...registration.packages, 'typescript', 'yaml'] },
      ...registration.runtime.map((runtime) => ({ runtime })),
    ];
    const actualAdapterInputs = (generate?.inputs ?? []).filter(
      (input) => input.externalDependencies || input.runtime || input === '{workspaceRoot}/openapitools.json',
    );
    if (!adapterInputs) problems.push(`${root}: unknown adapter "${adapter}" in openapi-clients.json`);
    else if (JSON.stringify(actualAdapterInputs) !== JSON.stringify(adapterInputs)) {
      problems.push(`${root}/project.json: generate inputs do not match adapter "${adapter}" (registry.json): expected ${JSON.stringify(adapterInputs)}`);
    }
    if (!generate?.outputs?.every((output) => output.endsWith('/src/generated'))) problems.push(`${node.name}: outputs must be the src/generated folders`);
    if (!node.data.targets?.['update-spec']) problems.push(`${node.name}: update-spec target missing`);
  }
  for (const { name, data } of parts) {
    const client = data.root.split('/').slice(0, -1).join('/');
    const clientNode = clientNodes.find((node) => node.data.root === client);
    if (!clientNode) problems.push(`${name}: no client project at ${client}`);
    // edges part → client (`^generate` reaches the client's generate, `affected` follows a spec change) → parts below
    else {
      const part = data.root.split('/').at(-1);
      const below = { types: [], core: ['types'], api: ['types', 'core'], testing: [] }[part] ?? [];
      const expected = [clientNode.name, ...below.filter((sibling) => existsSync(join(client, sibling, 'src/index.ts'))).map((sibling) => `${clientNode.name}-${sibling}`)];
      if (JSON.stringify(data.implicitDependencies) !== JSON.stringify(expected)) problems.push(`${name}: implicitDependencies must be ${JSON.stringify(expected)}`);
    }
    if (data.root.endsWith('/testing')) {
      const generate = data.targets?.generate;
      if (!generate?.cache || !generate.outputs?.includes('{projectRoot}/src/generated')) problems.push(`${name}: testing lib needs a cached generate → src/generated`);
      for (const target of ['lint', 'typecheck']) {
        if (!data.targets?.[target]?.dependsOn?.includes('generate')) problems.push(`${name}: ${target} must depend on its own generate`);
      }
    }
  }
  for (const { name, data } of libNodesOf(projectGraph)) {
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
 * Scans the client bundle for any trace of MSW, Vitest or faker. As Nx target (`tooling-verify:verify`) the
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

/**
 * Tooling libs (packages/tooling/<lib>): project `tooling-<lib>`, package `@blueprint/tooling-<lib>`, tags
 * `type:tooling` + `tooling:<lib>`. Every export of a tooling package that another one depends on needs an
 * exact entry in tsconfig.base.json `paths` (and back): Nx transpiles generators with swc + these paths
 * (straight onto the .ts sources, like the lib entries next to them).
 */
function checkToolingLibs(projectGraph) {
  const problems = [];
  const toolingRoot = 'packages/tooling';
  const libs = readdirSync(toolingRoot).filter((dir) => existsSync(join(toolingRoot, dir, 'package.json')));
  const packages = Object.fromEntries(
    libs.map((dir) => [dir, JSON.parse(readFileSync(join(toolingRoot, dir, 'package.json'), 'utf-8'))]),
  );
  const expectedPaths = {};
  for (const dir of libs) {
    const node = Object.values(projectGraph.nodes).find(({ data }) => data.root === `${toolingRoot}/${dir}`);
    if (packages[dir].name !== `@blueprint/tooling-${dir}`) problems.push(`${toolingRoot}/${dir}: package must be @blueprint/tooling-${dir}`);
    if (node?.name !== `tooling-${dir}`) problems.push(`${toolingRoot}/${dir}: project must be tooling-${dir}`);
    for (const tag of ['type:tooling', `tooling:${dir}`]) if (!node?.data.tags?.includes(tag)) problems.push(`tooling-${dir}: missing tag ${tag}`);
    const extraTestTargets = Object.keys(node?.data.targets ?? {}).filter((name) => name.startsWith('test-') || name.startsWith('test:'));
    if (extraTestTargets.length) problems.push(`tooling-${dir}: only one test target, found ${extraTestTargets.join(', ')}`);
    for (const dependency of Object.keys(packages[dir].dependencies ?? {}).filter((name) => name.startsWith('@blueprint/tooling-'))) {
      const target = dependency.slice('@blueprint/tooling-'.length);
      for (const [subpath, file] of Object.entries(packages[target]?.exports ?? {})) {
        if (subpath !== './package.json') expectedPaths[`${dependency}${subpath.slice(1)}`] = `./${toolingRoot}/${target}/${file.slice(2)}`;
      }
    }
  }
  // openapi: `test` = unit + integration with coverage (threshold in vitest.config.mts), coverage cached as output
  const openapiTest = Object.values(projectGraph.nodes).find(({ name }) => name === 'tooling-openapi')?.data.targets?.test;
  if (!openapiTest?.options?.command?.includes('--coverage') || /--project\b/.test(openapiTest.options.command) || !openapiTest.outputs?.includes('{projectRoot}/coverage')) {
    problems.push('tooling-openapi: test must run all vitest projects with --coverage, output {projectRoot}/coverage');
  }
  const { paths } = JSON.parse(readFileSync('tsconfig.base.json', 'utf-8')).compilerOptions;
  const actualPaths = Object.fromEntries(Object.entries(paths).filter(([alias]) => alias.startsWith('@blueprint/tooling-')));
  for (const alias of new Set([...Object.keys(expectedPaths), ...Object.keys(actualPaths)])) {
    if (JSON.stringify(actualPaths[alias]) !== JSON.stringify(expectedPaths[alias] && [expectedPaths[alias]])) {
      problems.push(`tsconfig.base.json paths["${alias}"]: expected ${JSON.stringify(expectedPaths[alias] ?? 'none')} (package exports), got ${JSON.stringify(actualPaths[alias] ?? 'none')}`);
    }
  }
  return { count: libs.length, aliases: Object.keys(expectedPaths).length, problems };
}

/**
 * CI runs `nx affected` without a tooling fallback: a tooling change must affect the projects whose tasks
 * use it — through the {workspaceRoot} inputs of those tasks (no graph edge from libs to tooling).
 * Probe per tooling area: `nx show projects --affected --files=<file>` contains the expected projects
 * (and, where the explicit config decouples them, not the unexpected ones).
 */
const AFFECTED_PROBES = [
  // the test wrapper (Vitest UI flag) is an input of every lib test
  { file: 'packages/tooling/ng-lib/src/test.js', expected: ['booking-state', 'shared-api', 'client'], notExpected: ['booking-types'] },
  // conventions: generators + every lint (the naming rules import them) — project.json holds the tags, no plugin
  { file: 'packages/tooling/conventions/src/lib-conventions.ts', expected: ['tooling-conventions', 'tooling-workspace', 'tooling-openapi', 'booking-ui', 'client'] },
  // naming rules (blueprint/*): an input of every lint target (nx.json targetDefaults). Specs are excluded from the
  // hash (cache hit), but `affected` ignores negated inputs — a spec change still marks every project affected
  { file: 'packages/tooling/eslint-rules/src/rules/lib-file-naming.ts', expected: ['booking-ui', 'shared-testing', 'generated-pet-client-api', 'client'] },
  { file: 'libs/booking/ui/project.json', expected: ['booking-ui', 'booking-shell', 'client'], notExpected: ['checkin-types'] },
  { file: 'tsconfig.base.json', expected: ['booking-ui', 'shared-testing', 'generated-pet-client-api', 'client'] },
  { file: 'packages/tooling/openapi/src/facade/facade.mjs', expected: ['generated-pet-client', 'booking-api', 'client'] },
  { file: 'packages/tooling/openapi/src/testing/testing.mjs', expected: ['booking-generated-booking-client-testing'] },
  { file: 'openapi-clients.json', expected: ['generated-pet-client-api', 'booking-generated-booking-client-testing', 'client'] },
  // integration tests of tooling-openapi run the jar: their workspace inputs affect it
  { file: 'openapitools.json', expected: ['tooling-openapi', 'generated-pet-client'] },
];

function checkAffected() {
  const problems = [];
  for (const { file, expected, notExpected = [] } of AFFECTED_PROBES) {
    const output = execFileSync('pnpm', ['exec', 'nx', 'show', 'projects', '--affected', `--files=${file}`, '--json'], { encoding: 'utf-8' });
    const affected = JSON.parse(output.slice(output.indexOf('[')));
    const missing = expected.filter((project) => !affected.includes(project));
    if (missing.length) problems.push(`${file}: does not affect ${missing.join(', ')} (task inputs?)`);
    const extra = notExpected.filter((project) => affected.includes(project));
    if (extra.length) problems.push(`${file}: should not affect ${extra.join(', ')}`);
  }
  return { count: AFFECTED_PROBES.length, problems };
}

/** The real config, but without `enforceBuildableLibDependency` — isolates the tag constraints. */
async function createTagsOnlyEslint() {
  const { blueprintDepConstraints } = await import('../../../../eslint.config.mjs');
  const rule = ['error', { enforceBuildableLibDependency: false, depConstraints: blueprintDepConstraints }];
  return new ESLint({
    cwd: workspaceRoot,
    overrideConfig: { files: ['**/*.ts'], rules: { '@nx/enforce-module-boundaries': rule } },
  });
}

/** The new lib (written with the generators' files) is a project with the tags and targets its path implies. */
function checkNewLib(projectGraph) {
  const node = Object.values(projectGraph.nodes).find(({ data }) => data.root === NEW_LIB);
  if (!node) return { problems: [`${NEW_LIB}: no project`] };
  const actual = { name: node.name, tags: node.data.tags, targets: Object.keys(node.data.targets).sort() };
  const same = JSON.stringify(actual) === JSON.stringify(NEW_LIB_EXPECTED);
  const problems = same ? [] : [`${NEW_LIB}: expected ${JSON.stringify(NEW_LIB_EXPECTED)}, got ${JSON.stringify(actual)}`];
  // the config guard accepts both temporary libs ...
  problems.push(...checkLibConfigFiles([NEW_LIB, NEW_TYPES_LIB]).problems);
  // ... and reports a lib with only src/index.ts
  mkdirSync(join(BARE_LIB, 'src'), { recursive: true });
  writeFileSync(join(BARE_LIB, 'src/index.ts'), 'export {};\n');
  const bare = checkLibConfigFiles([BARE_LIB]).problems;
  rmSync(BARE_LIB, { recursive: true, force: true });
  if (!bare.some((problem) => problem.includes('project.json: missing'))) problems.push(`${BARE_LIB} (only src/index.ts): not reported by the config guard`);
  return { actual, bare: bare.length, problems };
}

/**
 * Two temporary libs with the files the generators write (see packages/tooling/conventions/src/lib-files.ts)
 * + their paths entries. Returns the original tsconfig.base.json to restore.
 */
function createNewLibs() {
  const originalBase = readFileSync(BASE_TSCONFIG, 'utf-8');
  const base = JSON.parse(originalBase);
  for (const [root, content, tags] of [
    [NEW_LIB, 'export const probe = 1;\n', ['scope:booking', 'type:ui', 'feat:tmpverify']],
    [NEW_TYPES_LIB, 'export type Probe = string;\n', ['scope:booking', 'type:types', 'feat:tmpverify']],
  ]) {
    const offset = offsetOf(root);
    const libPath = root.slice('libs/'.length);
    const files = {
      'src/index.ts': content,
      'project.json': { name: libPath.replaceAll('/', '-'), projectType: 'library', sourceRoot: `${root}/src`, tags, targets: { build: {}, lint: {}, typecheck: {} } },
      'package.json': { name: `@blueprint/${libPath}`, version: '0.0.1', private: true, sideEffects: false },
      'ng-package.json': { dest: `${offset}dist/${root}`, lib: { entryFile: 'src/index.ts' } },
      'tsconfig.json': { extends: `${offset}tsconfig.base.json`, include: ['src/**/*.ts'] },
      'tsconfig.lib.json': { extends: './tsconfig.json', exclude: ['src/**/*.spec.ts'] },
      'tsconfig.lib.prod.json': { extends: './tsconfig.lib.json' },
    };
    for (const [file, value] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    }
    base.compilerOptions.paths[`@blueprint/${libPath}`] = [`./${root}/src/index.ts`];
  }
  writeFileSync(BASE_TSCONFIG, JSON.stringify(base, null, 2));
  return originalBase;
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
  const originalBase = createNewLibs();
  try {
    // the Nx rule silently skips without a cached graph — build it first
    const projectGraph = await createProjectGraphAsync({ exitOnError: true });
    const schema = checkTagSchema(projectGraph);
    const isolation = checkTestIsolation(projectGraph);
    const newLib = checkNewLib(projectGraph);
    const tooling = checkToolingLibs(projectGraph);
    const affected = checkAffected();
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
    for (const testCase of namingCases) {
      const findings = await lintNamingCase(testCase, eslint);
      const text = findings.map((f) => `${f.ruleId}: ${f.message}`).join(' | ');
      const pass = testCase.allowed
        ? findings.length === 0
        : findings.some((f) => f.ruleId === testCase.expectedRule && f.message.includes(testCase.expectedText));
      rows.push({ ...testCase, from: testCase.file, importPath: testCase.code.split('\n').at(-2) ?? '', pass, text });
    }
    const clients = checkGeneratedClients(projectGraph);
    const bundle = checkClientBundle();
    report(rows, libConfigs, schema, isolation, newLib, tooling, affected, clients, bundle);
    const problems = [libConfigs, schema, isolation, newLib, tooling, affected, clients, bundle].flatMap((check) => check.problems);
    process.exitCode = rows.every((r) => r.pass) && problems.length === 0 ? 0 : 1;
  } finally {
    rmSync(UNTAGGED_LIB, { recursive: true, force: true });
    rmSync(dirname(NEW_LIB), { recursive: true, force: true });
    writeFileSync(BASE_TSCONFIG, originalBase);
  }
}

function report(rows, libConfigs, schema, isolation, newLib, tooling, affected, clients, bundle) {
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
  console.log(`Explizite Config (project.json, tsconfig*.json, Build-Dateien, peerDependencies, paths-Eintrag): ${libConfigs.count} Libs geprüft, ${libConfigs.problems.length} Probleme`);
  libConfigs.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`Tag-Schema (project.json ↔ Pfad) + Ordnerregel (Form, Layer, kebab-case) + Scope-Liste (${SCOPES_FILE}): ${schema.count} Libs geprüft, ${schema.problems.length} Probleme`);
  schema.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`Test-Isolation (${isolation.count} Libs aus dem Graph: kein build für testing, Specs aus Build-tsconfig/production, ein test-Target (gecacht, headless, UI per --ui) nur mit Specs, kein committeter MSW-Worker): ${isolation.problems.length} Probleme`);
  isolation.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`Neue Lib (${NEW_LIB} mit den Dateien der Generatoren): ${newLib.problems.length ? 'NICHT ' : ''}Projekt ${JSON.stringify(newLib.actual ?? {})}; Lib nur mit src/index.ts: ${newLib.bare ?? 0} Meldungen des Config-Wächters`);
  newLib.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`Tooling-Libs: ${tooling.count} Libs (Name, Paket, Tags), ${tooling.aliases} Exporte ↔ tsconfig.base.json paths: ${tooling.problems.length} Probleme`);
  tooling.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`nx affected für Tooling-Dateien (CI ohne Tooling-Fallback): ${affected.count} Proben, ${affected.problems.length} Probleme`);
  affected.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(
    `Generierte Clients: ${clients.entries} Einträge in openapi-clients.json, ${clients.clients} Client-Projekte, ${clients.parts} Libs, ` +
      `${clients.generatedFiles} generierte Dateien (alle gitignored, keine committet); Konsistenz Eintrag ↔ Ordner ↔ Spec ↔ Libs, Kanten, Targets: ${clients.problems.length} Probleme`,
  );
  clients.problems.forEach((p) => console.log(`  - ${p}`));
  console.log(`client-Bundle: ${bundle.files} Dateien auf msw/vitest/faker geprüft, ${bundle.problems.length} Treffer`);
  bundle.problems.forEach((p) => console.log(`  - ${p}`));
}

await main();
