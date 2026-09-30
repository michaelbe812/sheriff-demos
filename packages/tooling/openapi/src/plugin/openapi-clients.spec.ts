import type { CreateNodesContextV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adapterRegistry,
  clientPartEdges,
  createClientProjects,
  createNodesV2,
  findSpecFile,
  readClientsConfig,
} from './openapi-clients';

const [marker, createNodes] = createNodesV2;
const SCOPES = { plugins: [{ plugin: '@blueprint/tooling-workspace', options: { scopes: ['booking', 'shared'] } }] };
const INDEX = "export * from './generated';\n";

describe('openapi plugin (createNodesV2)', () => {
  let root: string;
  const write = (path: string, content = ''): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const client = (clientPath: string, parts = ['types', 'api', 'core', 'testing'], spec = 'openapi.yaml'): void => {
    write(`libs/${clientPath}/${spec}`, 'openapi: 3.0.3\n');
    for (const part of parts) write(`libs/${clientPath}/${part}/src/index.ts`, INDEX);
  };
  const config = (clients: Record<string, unknown>, defaultAdapter?: string): void =>
    write('openapi-clients.json', JSON.stringify({ ...(defaultAdapter ? { defaultAdapter } : {}), clients }));
  const context = (nxJson: object = SCOPES) =>
    ({ workspaceRoot: root, nxJsonConfiguration: nxJson, configFiles: [] }) as unknown as CreateNodesContextV2;
  const run = async (files: string[], nxJson?: object) =>
    Object.fromEntries(
      (await createNodes(files, undefined, context(nxJson))).map(([file, result]) => [file, result.projects ?? {}]),
    ) as Record<string, Record<string, ProjectConfiguration>>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openapi-plugin-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('marks openapi-clients.json and the committed index.ts of every client part', () => {
    expect(marker).toBe('{openapi-clients.json,libs/**/generated/*/*/src/index.ts}');
  });

  it('one client project per entry: tags, generate (json-field input, registry inputs), update-spec', async () => {
    client('generated/pet-client');
    client('booking/generated/booking-client', ['types', 'api', 'testing'], 'openapi.json');
    config(
      { 'generated/pet-client': { url: 'https://x' }, 'booking/generated/booking-client': { adapter: 'hey-api' } },
      'openapi-tools',
    );

    const projects = (await run(['openapi-clients.json']))['openapi-clients.json'];
    const pet = projects['libs/generated/pet-client'];
    expect(pet).toMatchObject({
      name: 'generated-pet-client',
      root: 'libs/generated/pet-client',
      tags: ['scope:shared', 'generated'],
    });
    const generate = pet.targets?.['generate'] as TargetConfiguration;
    expect(generate).toMatchObject({
      executor: '@blueprint/tooling-openapi:generate',
      cache: true,
      options: { client: 'generated/pet-client' },
      outputs: [
        '{projectRoot}/types/src/generated',
        '{projectRoot}/api/src/generated',
        '{projectRoot}/core/src/generated',
      ],
    });
    expect(generate.inputs).toEqual([
      '{workspaceRoot}/libs/generated/pet-client/openapi.yaml',
      { json: '{workspaceRoot}/openapi-clients.json', fields: ['defaultAdapter', 'clients.generated/pet-client'] },
      '{workspaceRoot}/libs/generated/pet-client/types/src/index.ts',
      '{workspaceRoot}/libs/generated/pet-client/api/src/index.ts',
      '{workspaceRoot}/libs/generated/pet-client/core/src/index.ts',
      '{workspaceRoot}/packages/tooling/openapi/src/facade/**/*',
      '{workspaceRoot}/packages/tooling/openapi/src/executors/**/*',
      '{workspaceRoot}/openapitools.json',
      { externalDependencies: ['@openapitools/openapi-generator-cli', 'typescript', 'yaml'] },
      { runtime: 'java -version 2>&1' },
    ]);
    expect(pet.targets?.['update-spec']).toEqual({
      executor: '@blueprint/tooling-openapi:update-spec',
      cache: false,
      inputs: ['{workspaceRoot}/openapi-clients.json'],
      options: { client: 'generated/pet-client' },
      metadata: { description: "Downloads the entry's url into libs/generated/pet-client/openapi.yaml (normalized)" },
    });

    const booking = projects['libs/booking/generated/booking-client'];
    expect(booking.tags).toEqual(['scope:booking', 'generated']);
    // the entry's adapter wins over defaultAdapter: its packages are the inputs
    expect((booking.targets?.['generate'] as TargetConfiguration).inputs).toContainEqual({
      externalDependencies: ['@hey-api/openapi-ts', 'typescript', 'yaml'],
    });
    expect(booking.metadata?.description).toContain('spec libs/booking/generated/booking-client/openapi.json');
  });

  it('adapter fallback: entry → defaultAdapter → openapi-tools; no clients, no scope list', async () => {
    client('generated/a-client');
    config({ 'generated/a-client': {} });
    const projects = (await run(['openapi-clients.json'], {}))['openapi-clients.json'];
    expect(
      (projects['libs/generated/a-client'].targets?.['generate'] as TargetConfiguration).metadata?.description,
    ).toContain('(openapi-tools)');
    expect(createClientProjects(root, {}, undefined)).toEqual({});
  });

  it('part libs: edges to the client (+ parts below), the testing part generates before lint/typecheck', async () => {
    client('booking/generated/booking-client');
    config({ 'booking/generated/booking-client': {} });
    const parts = ['types', 'api', 'core', 'testing'].map(
      (part) => `libs/booking/generated/booking-client/${part}/src/index.ts`,
    );
    const results = await run(parts);
    const node = (part: string) =>
      results[`libs/booking/generated/booking-client/${part}/src/index.ts`][
        `libs/booking/generated/booking-client/${part}`
      ];

    expect(node('types')).toEqual({
      root: 'libs/booking/generated/booking-client/types',
      implicitDependencies: ['booking-generated-booking-client'],
    });
    expect(node('api').implicitDependencies).toEqual([
      'booking-generated-booking-client',
      'booking-generated-booking-client-types',
      'booking-generated-booking-client-core',
    ]);
    expect(node('core').implicitDependencies).toEqual([
      'booking-generated-booking-client',
      'booking-generated-booking-client-types',
    ]);
    // partial configuration: name, tags and the other targets come from the workspace plugin
    expect(node('testing').name).toBeUndefined();
    expect(node('testing').targets).toEqual({
      generate: {
        executor: '@blueprint/tooling-openapi:generate-testing',
        cache: true,
        inputs: [
          '{workspaceRoot}/libs/booking/generated/booking-client/openapi.yaml',
          '{workspaceRoot}/packages/tooling/openapi/src/facade/facade.mjs',
          '{workspaceRoot}/packages/tooling/openapi/src/testing/**/*',
          '{workspaceRoot}/packages/tooling/openapi/src/executors/generate-testing.js',
          { externalDependencies: ['openapi-typescript', 'orval', 'yaml'] },
        ],
        outputs: ['{projectRoot}/src/generated'],
        options: { client: 'booking/generated/booking-client' },
        metadata: {
          description:
            'Generates MSW handlers, faker factories and the typed <client>Http from libs/booking/generated/booking-client/openapi.yaml',
        },
      },
      lint: { dependsOn: ['generate', '...'] },
      typecheck: { dependsOn: ['generate', '...'] },
    });
  });

  it('edges skip parts that are not committed (core is optional), unknown part → client only', () => {
    client('generated/lean-client', ['types', 'api']);
    expect(clientPartEdges(root, { path: 'generated/lean-client', part: 'api' })).toEqual([
      'generated-lean-client',
      'generated-lean-client-types',
    ]);
    expect(clientPartEdges(root, { path: 'generated/lean-client', part: 'docs' })).toEqual(['generated-lean-client']);
  });

  it('a lib below a generated folder that is no client part is left to the workspace plugin', async () => {
    config({});
    expect(await run(['libs/generated/x/y/z/src/index.ts'])).toEqual({ 'libs/generated/x/y/z/src/index.ts': {} });
  });

  it('graph errors: part without entry, entry without / with two specs, unknown adapter, bad key, scope outside the list', async () => {
    client('generated/orphan-client');
    config({});
    await expect(run(['libs/generated/orphan-client/api/src/index.ts'])).rejects.toThrow(
      'libs/generated/orphan-client/api: part of client "generated/orphan-client", but openapi-clients.json has no entry for it (nx g @blueprint/tooling-openapi:client orphan-client …, or remove libs/generated/orphan-client)',
    );

    config({ 'generated/nospec-client': {} });
    await expect(run(['openapi-clients.json'])).rejects.toThrow(
      'openapi-clients.json → "generated/nospec-client": libs/generated/nospec-client needs exactly one spec file (openapi.yaml | openapi.json), found none. New client: nx g @blueprint/tooling-openapi:client <name> --spec=<file|url>',
    );
    client('generated/two-client');
    write('libs/generated/two-client/openapi.json', '{}');
    expect(() => findSpecFile(root, 'generated/two-client')).toThrow('found openapi.yaml, openapi.json');

    client('generated/odd-client');
    config({ 'generated/odd-client': { adapter: 'swagger-codegen' } });
    await expect(run(['openapi-clients.json'])).rejects.toThrow(
      'openapi-clients.json → "generated/odd-client": unknown adapter "swagger-codegen" (known: openapi-tools, hey-api, nx-plugin-openapi)',
    );

    config({ 'pet-client': {} });
    await expect(run(['openapi-clients.json'])).rejects.toThrow(
      'openapi-clients.json → "pet-client": not a client path (generated/<client> or <domain>/generated/<client>)',
    );

    client('payment/generated/pay-client');
    config({ 'payment/generated/pay-client': {} });
    await expect(run(['openapi-clients.json'])).rejects.toThrow(
      'openapi-clients.json → "payment/generated/pay-client": scope "payment" is not in the scope list (nx.json)',
    );
  });

  it('openapi-clients.json: missing → no clients, broken JSON → graph error', () => {
    expect(readClientsConfig(root)).toEqual({});
    write('openapi-clients.json', '{ "clients": ');
    expect(() => readClientsConfig(root)).toThrow(/^openapi-clients\.json: invalid JSON \(/);
  });

  it('adapter registry: the three adapters, $-keys (comments) filtered, read once', () => {
    const registry = adapterRegistry();
    expect(Object.keys(registry)).toEqual(['openapi-tools', 'hey-api', 'nx-plugin-openapi']);
    expect(adapterRegistry()).toBe(registry);
  });
});
