/**
 * Local Nx "crystal" plugin: infers every blueprint lib from the folder
 * convention instead of a per-lib project.json / tsconfig.json.
 *
 *   marker     libs/<scope>/<layer>/src/index.ts
 *              libs/<scope>/feat-<feat>/<layer>/src/index.ts
 *   name       path below libs/ joined with "-"   (booking-feat-check-booking-data)
 *   alias      @blueprint/<path below libs/>      (resolved by the tsconfig.base.json wildcard)
 *   tags       derived from the path — a typo in a tag can no longer happen
 *              (a `testing` folder = test-only lib: `type:testing`)
 *   targets    lint, typecheck, build (not for testing libs), test (only if src/ has *.spec.ts)
 *
 * The tag derivation is the single source of truth: eslint.config.mjs and
 * packages/tooling/scripts/verify-boundaries.mjs read the tags from the project graph.
 */
// type-only: importing @nx/devkit at runtime costs ~0.5 s per graph computation in the isolated plugin worker
import type { CreateNodesResult, CreateNodesV2, TargetConfiguration } from '@nx/devkit';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LIB_MARKER = 'libs/**/src/index.ts';
const ALIAS_PREFIX = '@blueprint/';

/** Layer folders that are a `type:feature` lib (slice root shell + feat container). */
const FEATURE_LAYERS = ['shell', 'feature'];
/** Test-only libs (MSW handlers, fixtures): never built, never shipped. */
const TESTING_LAYER = 'testing';
/** Every layer folder the depConstraints know. Anything else would get an unconstrained `type:` tag. */
const KNOWN_LAYERS = ['types', 'utils', 'events', 'api', 'data', 'ui', ...FEATURE_LAYERS, TESTING_LAYER];

/** Tags of a lib, derived purely from its path below `libs/` (e.g. `booking/feat-check-booking/api`). */
export function deriveTags(libPath: string): string[] {
  const [scope, ...rest] = libPath.split('/');
  const layer = rest.at(-1) ?? '';
  const featFolder = rest.find((segment) => segment.startsWith('feat-'));
  const validShape = rest.length === 1 || (rest.length === 2 && featFolder === rest[0]);
  if (!validShape || !KNOWN_LAYERS.includes(layer)) {
    // fail the graph instead of silently creating an unconstrained lib (the old tag-typo problem)
    throw new Error(
      `libs/${libPath}: not a blueprint lib path — expected libs/<scope>/<layer> or libs/<scope>/feat-<feat>/<layer>, layer one of ${KNOWN_LAYERS.join(', ')}`,
    );
  }
  const tags = [
    `scope:${scope}`,
    `type:${FEATURE_LAYERS.includes(layer) ? 'feature' : layer}`,
    featFolder ? `feat:${featFolder.slice('feat-'.length)}` : 'feat:none',
  ];
  if (layer === 'shell') tags.push('entry');
  if (layer === 'api' && scope !== 'shared') tags.push(featFolder ? 'feat-port' : 'port');
  return tags;
}

/** Executors of this package (executors.json). */
export const NG_LIB_EXECUTORS = {
  build: '@blueprint/tooling:ng-lib-build',
  test: '@blueprint/tooling:ng-lib-test',
};
const NG_LIB_INPUT = '{workspaceRoot}/packages/tooling/src/executors/ng-lib/**/*';
const TYPECHECK_SCRIPT = 'packages/tooling/scripts/typecheck-lib.mjs';
const TYPECHECK_SCRIPT_INPUT = `{workspaceRoot}/${TYPECHECK_SCRIPT}`;

/** Shared tsconfigs every lib compiles with — they live outside the lib, so they are explicit inputs. */
const SHARED_TS_INPUTS = ['{workspaceRoot}/tsconfig.base.json', '{workspaceRoot}/libs/tsconfig.json'];

const hasSpecFiles = (dir: string): boolean =>
  existsSync(dir) &&
  readdirSync(dir, { recursive: true }).some((file) => String(file).endsWith('.spec.ts'));

function libTargets(workspaceRoot: string, projectRoot: string, isTestingLib: boolean) {
  const targets: Record<string, TargetConfiguration> = {
    lint: {
      // same shape as @nx/eslint/plugin infers (the @nx/eslint:lint executor is deprecated in Nx 24);
      // only the root eslint.config.mjs exists, ESLint finds it by walking up
      executor: 'nx:run-commands',
      cache: true,
      inputs: [
        'default',
        '^default',
        '{workspaceRoot}/eslint.config.mjs',
        '{workspaceRoot}/packages/tooling/src/plugin/**/*',
        { externalDependencies: ['eslint'] },
      ],
      options: { command: 'eslint .', cwd: '{projectRoot}' },
    },
    typecheck: {
      // one shared libs/tsconfig.json, narrowed to this lib's sources in memory — no per-lib tsconfig
      executor: 'nx:run-commands',
      cache: true,
      inputs: [
        'default',
        '^default',
        ...SHARED_TS_INPUTS,
        TYPECHECK_SCRIPT_INPUT,
        { externalDependencies: ['typescript'] },
      ],
      options: { command: `node ${TYPECHECK_SCRIPT} {projectRoot}` },
    },
    // ng-lib-build generates ng-package.json, package.json and tsconfig (dist paths) in tmp/
    // and delegates to @nx/angular:ng-packagr-lite — no build files in the lib
    build: {
      executor: NG_LIB_EXECUTORS.build,
      cache: true,
      dependsOn: ['^build'],
      inputs: [
        'production',
        '^production',
        ...SHARED_TS_INPUTS,
        '{workspaceRoot}/libs/tsconfig.lib.json',
        NG_LIB_INPUT,
        { externalDependencies: ['ng-packagr', '@angular/compiler-cli', 'typescript'] },
      ],
      outputs: ['{workspaceRoot}/dist/{projectRoot}'],
      defaultConfiguration: 'production',
      options: { tsConfig: 'libs/tsconfig.lib.json' },
      configurations: {
        production: { compilerOptions: { declarationMap: false } },
        development: {},
      },
    },
  };
  // test-only libs are consumed from source by the specs — never built, never shipped
  if (isTestingLib) delete targets['build'];
  if (hasSpecFiles(join(workspaceRoot, projectRoot, 'src'))) {
    // Vitest browser mode (Chromium) via @nx/angular:unit-test; the wrapper narrows the shared
    // spec tsconfig to this lib and maps the ng-lib build target for the Angular builder
    targets['test'] = {
      executor: NG_LIB_EXECUTORS.test,
      cache: true,
      inputs: [
        'default',
        '^production',
        ...SHARED_TS_INPUTS,
        '{workspaceRoot}/libs/tsconfig.spec.json',
        NG_LIB_INPUT,
        '{workspaceRoot}/vitest-base.config.mts',
        { externalDependencies: ['vitest', '@vitest/browser-playwright', 'msw', '@angular/build'] },
      ],
      options: {
        tsConfig: 'libs/tsconfig.spec.json',
        runnerConfig: 'vitest-base.config.mts',
        browsers: ['chromiumHeadless'],
        watch: false,
      },
    };
  }
  return targets;
}

function createLibNode(indexFile: string, workspaceRoot: string): CreateNodesResult {
  const projectRoot = dirname(dirname(indexFile));
  const libPath = projectRoot.slice('libs/'.length);
  const tags = deriveTags(libPath);
  return {
    projects: {
      [projectRoot]: {
        name: libPath.replaceAll('/', '-'),
        root: projectRoot,
        sourceRoot: `${projectRoot}/src`,
        projectType: 'library',
        tags,
        metadata: { js: { packageName: `${ALIAS_PREFIX}${libPath}` } },
        targets: libTargets(workspaceRoot, projectRoot, tags.includes(`type:${TESTING_LAYER}`)),
      },
    },
  };
}

export const createNodesV2: CreateNodesV2 = [
  LIB_MARKER,
  // same contract as devkit's createNodesFromFiles, but errors are collected per file by Nx anyway
  (indexFiles, _options, context) =>
    indexFiles.map((indexFile) => [indexFile, createLibNode(indexFile, context.workspaceRoot)] as const),
];
