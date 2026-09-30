/**
 * `nx` itself in a fixture workspace with both plugins (workspace + openapi, as in nx.json of the repo):
 * the merged project configuration of a client (tags, edges, targets, inputs incl. json fields and
 * dependentTasksOutputFiles) and `nx run …:generate` through the real executors, cached on the second run.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addClient, createWorkspace, removeWorkspace, repoRoot, write } from '../helpers.mjs';

const TOOLING_PATHS = Object.fromEntries(
  Object.entries(
    JSON.parse(readFileSync(join(repoRoot, 'tsconfig.base.json'), 'utf-8')).compilerOptions.paths as Record<
      string,
      string[]
    >,
  )
    .filter(([alias]) => alias.startsWith('@blueprint/tooling-'))
    .map(([alias, [target]]) => [alias, [join(repoRoot, target)]]),
);

describe('nx in a fixture workspace', () => {
  let root: string;
  const nx = (...args: string[]): string =>
    execFileSync(process.execPath, [join(repoRoot, 'node_modules/nx/dist/bin/nx.js'), ...args], {
      cwd: root,
      encoding: 'utf-8',
      // own daemon-less graph/cache: never the repo's (the test may itself run as an Nx task)
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NX_'))),
        NX_DAEMON: 'false',
        NX_NO_CLOUD: 'true',
        NX_CACHE_DIRECTORY: join(root, '.nx/cache'),
        NX_WORKSPACE_DATA_DIRECTORY: join(root, '.nx/workspace-data'),
      },
    });
  const project = (name: string) => JSON.parse(nx('show', 'project', name, '--json'));

  beforeAll(() => {
    root = createWorkspace('nx');
    // the repo's manifest + lockfile: Nx resolves the externalDependencies inputs (adapter versions) from them
    write(root, 'package.json', readFileSync(join(repoRoot, 'package.json'), 'utf-8'));
    write(root, 'pnpm-lock.yaml', readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf-8'));
    write(
      root,
      'nx.json',
      JSON.stringify({
        plugins: [
          { plugin: '@blueprint/tooling-workspace', options: { scopes: ['booking', 'shared'] } },
          '@blueprint/tooling-openapi',
        ],
      }),
    );
    // like the repo: exact paths for the tooling exports (Nx loads the plugins with swc + these paths), libs wildcard
    write(
      root,
      'tsconfig.base.json',
      JSON.stringify({ compilerOptions: { paths: { ...TOOLING_PATHS, '@blueprint/*': ['./libs/*/src/index.ts'] } } }),
    );
    addClient(root, 'booking/generated/things-client', { entry: { adapter: 'hey-api' } });
  });
  afterAll(() => removeWorkspace(root));

  it('merges both plugins: the workspace plugin infers the part libs, the openapi plugin adds client, edges, generate', () => {
    const testing = project('booking-generated-things-client-testing');
    expect(testing.tags).toEqual(['scope:booking', 'type:testing', 'feat:none', 'generated']);
    expect(testing.implicitDependencies).toEqual(['booking-generated-things-client']);
    expect(testing.targets.generate.executor).toBe('@blueprint/tooling-openapi:generate-testing');
    expect(testing.targets.lint.dependsOn).toEqual(['generate', '^generate']);
    expect(testing.targets.typecheck.dependsOn).toEqual(['generate', '^generate']);
    expect(testing.targets.lint.inputs).toContainEqual({
      dependentTasksOutputFiles: '**/src/generated/**/*.ts',
      transitive: true,
    });
    expect(testing.targets.build).toBeUndefined();

    const api = project('booking-generated-things-client-api');
    expect(api.implicitDependencies).toEqual([
      'booking-generated-things-client',
      'booking-generated-things-client-types',
      'booking-generated-things-client-core',
    ]);
    expect(api.targets.build.dependsOn).toEqual(['^build', '^generate']);

    const client = project('booking-generated-things-client');
    expect(client.tags).toEqual(['scope:booking', 'generated']);
    expect(client.targets.generate.inputs).toContainEqual({
      json: '{workspaceRoot}/openapi-clients.json',
      fields: ['defaultAdapter', 'clients.booking/generated/things-client'],
    });
    expect(client.targets.generate.options).toEqual({ client: 'booking/generated/things-client' });
  });

  it('nx run …:generate runs the executors; the second run comes from the cache', () => {
    expect(nx('run', 'booking-generated-things-client:generate')).toContain(
      'booking-generated-things-client: hey-api → {"types":1',
    );
    expect(existsSync(join(root, 'libs/booking/generated/things-client/api/src/generated/sdk.gen.ts'))).toBe(true);
    expect(nx('run', 'booking-generated-things-client:generate')).toMatch(
      /local cache|existing outputs match the cache/,
    );

    expect(nx('run', 'booking-generated-things-client-testing:generate')).toContain(
      'booking-generated-things-client-testing:',
    );
    expect(existsSync(join(root, 'libs/booking/generated/things-client/testing/src/generated/handlers.ts'))).toBe(true);
  });

  it('a part without entry fails the graph', () => {
    write(root, 'libs/generated/orphan-client/api/src/index.ts', "export * from './generated';\n");
    expect(() => nx('show', 'projects')).toThrow(
      /part of client "generated\/orphan-client", but openapi-clients\.json has no entry/,
    );
  });
});
