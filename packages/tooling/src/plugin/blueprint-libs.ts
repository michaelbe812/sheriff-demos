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
 *   scopes     option `scopes` (nx.json): a folder libs/<unknown scope>/… fails the graph
 *              instead of silently creating a new scope (folder typo guard)
 *   targets    lint, typecheck, build (not for testing libs), test (only if src/ has *.spec.ts);
 *              every target depends on `^generate` and hashes the generated code of those tasks
 *   clients    openapi-clients.json (second marker): one client project per entry with `generate`
 *              (+ `update-spec`), see openapi-clients.ts. Client libs libs/[<domain>/]generated/<client>/<part>
 *              get their tags from the path and implicit edges part → client (→ sibling parts)
 *
 * Conventions (layers, tags, scope check) live in lib-conventions.ts and are shared
 * with the generators. The tag derivation is the single source of truth: eslint.config.mjs and
 * packages/tooling/scripts/verify-boundaries.mjs read the tags from the project graph.
 */
// type-only: importing @nx/devkit at runtime costs ~0.5 s per graph computation in the isolated plugin worker
import type { CreateNodesResult, CreateNodesV2, TargetConfiguration } from '@nx/devkit';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  aliasFor,
  type BlueprintLibsOptions,
  CLIENTS_CONFIG_FILE,
  deriveTags,
  LIBS_DIR,
  parseLibPath,
  projectNameFor,
  TESTING_LAYER,
} from './lib-conventions';
import {
  clientPartEdges,
  type ClientsConfig,
  createClientProjects,
  generateTestingTarget,
  readClientsConfig,
} from './openapi-clients';

export { deriveTags } from './lib-conventions';

/** libs (committed src/index.ts) + the client list — one plugin, one pass */
const MARKER = `{${LIBS_DIR}/**/src/index.ts,${CLIENTS_CONFIG_FILE}}`;

/** Executors of @blueprint/tooling-ng-lib (packages/tooling/ng-lib). */
export const NG_LIB_EXECUTORS = {
  build: '@blueprint/tooling-ng-lib:build',
  test: '@blueprint/tooling-ng-lib:test',
};
const NG_LIB_INPUT = '{workspaceRoot}/packages/tooling/ng-lib/src/**/*';
const TYPECHECK_SCRIPT = 'packages/tooling/ng-lib/scripts/typecheck-lib.mjs';
const TYPECHECK_SCRIPT_INPUT = `{workspaceRoot}/${TYPECHECK_SCRIPT}`;

/** Shared tsconfigs every lib compiles with — they live outside the lib, so they are explicit inputs. */
const SHARED_TS_INPUTS = ['{workspaceRoot}/tsconfig.base.json', '{workspaceRoot}/libs/tsconfig.json'];

/**
 * Generated client code is gitignored — Nx neither hashes nor analyzes gitignored files, so
 * `default`/`^production` do not see it. Without this input a changed spec regenerates the client
 * but consumers hit a stale cache (proven in the spike: renamed property, typecheck came from cache).
 * The outputs of the (transitive) generate tasks the target depends on are hashed instead.
 */
const GENERATED_CODE_INPUT = { dependentTasksOutputFiles: '**/src/generated/**/*.ts', transitive: true };
/** Every lib target waits for the generated code of the libs it depends on (no-op without clients). */
const GENERATE_DEPS = '^generate';

const hasSpecFiles = (dir: string): boolean =>
  existsSync(dir) && readdirSync(dir, { recursive: true }).some((file) => String(file).endsWith('.spec.ts'));

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
        GENERATED_CODE_INPUT,
        { externalDependencies: ['eslint'] },
      ],
      dependsOn: [GENERATE_DEPS],
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
        GENERATED_CODE_INPUT,
        { externalDependencies: ['typescript'] },
      ],
      dependsOn: [GENERATE_DEPS],
      options: { command: `node ${TYPECHECK_SCRIPT} {projectRoot}` },
    },
    // ng-lib-build generates ng-package.json, package.json and tsconfig (dist paths) in tmp/
    // and delegates to @nx/angular:ng-packagr-lite — no build files in the lib
    build: {
      executor: NG_LIB_EXECUTORS.build,
      cache: true,
      dependsOn: ['^build', GENERATE_DEPS],
      inputs: [
        'production',
        '^production',
        ...SHARED_TS_INPUTS,
        '{workspaceRoot}/libs/tsconfig.lib.json',
        NG_LIB_INPUT,
        GENERATED_CODE_INPUT,
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
        GENERATED_CODE_INPUT,
        {
          externalDependencies: [
            'vitest',
            '@vitest/browser-playwright',
            'msw',
            'openapi-msw',
            '@faker-js/faker',
            '@angular/build',
          ],
        },
      ],
      dependsOn: [GENERATE_DEPS],
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

function createLibNode(
  indexFile: string,
  workspaceRoot: string,
  options: BlueprintLibsOptions,
  clients: ClientsConfig,
): CreateNodesResult {
  const projectRoot = dirname(dirname(indexFile));
  const libPath = projectRoot.slice(`${LIBS_DIR}/`.length);
  const tags = deriveTags(libPath, options);
  const client = parseLibPath(libPath)?.client;
  if (client && !clients.clients?.[client.path]) {
    throw new Error(
      `${projectRoot}: part of client "${client.path}", but ${CLIENTS_CONFIG_FILE} has no entry for it ` +
        `(nx g @blueprint/tooling:client ${client.name} …, or remove ${LIBS_DIR}/${client.path})`,
    );
  }
  // gitignored generated code is invisible to the graph: part → client (generate, affected), api → core → types
  const implicitDependencies = client ? clientPartEdges(workspaceRoot, client) : [];
  const targets = libTargets(workspaceRoot, projectRoot, tags.includes(`type:${TESTING_LAYER}`));
  if (client?.part === TESTING_LAYER) {
    // the client's testing lib generates its own code (from the spec only) before lint/typecheck
    targets['generate'] = generateTestingTarget(workspaceRoot, client.path);
    for (const name of ['lint', 'typecheck'])
      targets[name].dependsOn = ['generate', ...(targets[name].dependsOn ?? [])];
  }
  return {
    projects: {
      [projectRoot]: {
        name: projectNameFor(libPath),
        root: projectRoot,
        sourceRoot: `${projectRoot}/src`,
        projectType: 'library',
        tags,
        metadata: { js: { packageName: aliasFor(libPath) } },
        targets,
        ...(implicitDependencies.length ? { implicitDependencies } : {}),
      },
    },
  };
}

export const createNodesV2: CreateNodesV2<BlueprintLibsOptions> = [
  MARKER,
  (files, options = {}, context) => {
    const clients = readClientsConfig(context.workspaceRoot);
    return files.map((file) =>
      file === CLIENTS_CONFIG_FILE
        ? ([file, { projects: createClientProjects(context.workspaceRoot, clients, options.scopes) }] as const)
        : ([file, createLibNode(file, context.workspaceRoot, options, clients)] as const),
    );
  },
];
