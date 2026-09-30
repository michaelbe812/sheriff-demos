import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adapterOf,
  adapterRegistry,
  clientPartConfig,
  clientPartEdges,
  clientProjectJson,
  findSpecFile,
  generateTestingTarget,
} from './project-config';

const INDEX = "export * from './generated';\n";

describe('explicit client config (project.json of clients and parts)', () => {
  let root: string;
  const write = (path: string, content = ''): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  const exists = (path: string): boolean => existsSync(join(root, path));
  const client = (clientPath: string, parts = ['types', 'api', 'core', 'testing'], spec = 'openapi.yaml'): void => {
    write(`libs/${clientPath}/${spec}`, 'openapi: 3.0.3\n');
    for (const part of parts) write(`libs/${clientPath}/${part}/src/index.ts`, INDEX);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openapi-config-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('client project: tags, generate (json-field input, registry inputs of the adapter), update-spec', () => {
    client('generated/pet-client');
    const pet = clientProjectJson(exists, 'generated/pet-client', {
      defaultAdapter: 'openapi-tools',
      clients: { 'generated/pet-client': { url: 'https://x' } },
    });
    expect(pet).toMatchObject({
      name: 'generated-pet-client',
      $schema: '../../../node_modules/nx/schemas/project-schema.json',
      projectType: 'library',
      tags: ['scope:shared', 'generated'],
    });
    const targets = pet['targets'] as Record<string, Record<string, unknown>>;
    expect(targets['generate']).toEqual({
      executor: '@blueprint/tooling-openapi:generate',
      cache: true,
      inputs: [
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
      ],
      outputs: [
        '{projectRoot}/types/src/generated',
        '{projectRoot}/api/src/generated',
        '{projectRoot}/core/src/generated',
      ],
      options: { client: 'generated/pet-client' },
    });
    expect(targets['update-spec']).toEqual({
      executor: '@blueprint/tooling-openapi:update-spec',
      cache: false,
      inputs: ['{workspaceRoot}/openapi-clients.json'],
      options: { client: 'generated/pet-client' },
    });
  });

  it('domain client: scope of the domain, the entry adapter wins over defaultAdapter', () => {
    client('booking/generated/booking-client', ['types', 'api', 'testing'], 'openapi.json');
    const booking = clientProjectJson(exists, 'booking/generated/booking-client', {
      defaultAdapter: 'openapi-tools',
      clients: { 'booking/generated/booking-client': { adapter: 'hey-api' } },
    });
    expect(booking['$schema']).toBe('../../../../node_modules/nx/schemas/project-schema.json');
    expect(booking['tags']).toEqual(['scope:booking', 'generated']);
    const generate = (booking['targets'] as Record<string, { inputs: unknown[] }>)['generate'];
    expect(generate.inputs[0]).toBe('{workspaceRoot}/libs/booking/generated/booking-client/openapi.json');
    expect(generate.inputs).toContainEqual({ externalDependencies: ['@hey-api/openapi-ts', 'typescript', 'yaml'] });
    expect(generate.inputs).not.toContainEqual({ runtime: 'java -version 2>&1' });
  });

  it('adapter fallback: entry → defaultAdapter → openapi-tools; unknown adapter fails', () => {
    expect(adapterOf('generated/a', { clients: { 'generated/a': {} } })).toBe('openapi-tools');
    expect(adapterOf('generated/a', { defaultAdapter: 'hey-api', clients: {} })).toBe('hey-api');
    expect(adapterOf('generated/a', {})).toBe('openapi-tools');
    expect(() =>
      adapterOf('generated/odd-client', { clients: { 'generated/odd-client': { adapter: 'swagger-codegen' } } }),
    ).toThrow(
      'openapi-clients.json → "generated/odd-client": unknown adapter "swagger-codegen" (known: openapi-tools, hey-api, nx-plugin-openapi)',
    );
  });

  it('part libs: edges to the client (+ parts below), the testing part generates before lint/typecheck', () => {
    client('booking/generated/booking-client');
    const clientPath = 'booking/generated/booking-client';
    expect(clientPartConfig(exists, clientPath, 'types')).toEqual({
      implicitDependencies: ['booking-generated-booking-client'],
      peerDependencies: {},
    });
    expect(clientPartConfig(exists, clientPath, 'api').implicitDependencies).toEqual([
      'booking-generated-booking-client',
      'booking-generated-booking-client-types',
      'booking-generated-booking-client-core',
    ]);
    expect(clientPartConfig(exists, clientPath, 'core').implicitDependencies).toEqual([
      'booking-generated-booking-client',
      'booking-generated-booking-client-types',
    ]);
    expect(clientPartConfig(exists, clientPath, 'testing')).toEqual({
      implicitDependencies: ['booking-generated-booking-client'],
      peerDependencies: {},
      targets: {
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
          options: { client: clientPath },
        },
        lint: { dependsOn: ['generate', '^generate'] },
        typecheck: { dependsOn: ['generate', '^generate'] },
      },
    });
    expect(generateTestingTarget(clientPath, 'x.yaml')['inputs']).toContain('{workspaceRoot}/x.yaml');
  });

  it('edges skip parts that are not committed (core is optional), unknown part → client only', () => {
    client('generated/lean-client', ['types', 'api']);
    expect(clientPartEdges(exists, { path: 'generated/lean-client', part: 'api' })).toEqual([
      'generated-lean-client',
      'generated-lean-client-types',
    ]);
    expect(clientPartEdges(exists, { path: 'generated/lean-client', part: 'docs' })).toEqual(['generated-lean-client']);
  });

  it('errors: bad client path, no spec / two specs', () => {
    expect(() => clientProjectJson(exists, 'pet-client', {})).toThrow(
      'openapi-clients.json → "pet-client": not a client path (generated/<client> or <domain>/generated/<client>)',
    );
    expect(() => clientProjectJson(exists, 'generated/nospec-client', {})).toThrow(
      'openapi-clients.json → "generated/nospec-client": libs/generated/nospec-client needs exactly one spec file (openapi.yaml | openapi.json), found none. New client: nx g @blueprint/tooling-openapi:client <name> --spec=<file|url>',
    );
    client('generated/two-client');
    write('libs/generated/two-client/openapi.json', '{}');
    expect(() => findSpecFile(exists, 'generated/two-client')).toThrow('found openapi.yaml, openapi.json');
  });

  it('adapter registry: the three adapters, $-keys (comments) filtered, read once', () => {
    const registry = adapterRegistry();
    expect(Object.keys(registry)).toEqual(['openapi-tools', 'hey-api', 'nx-plugin-openapi']);
    expect(adapterRegistry()).toBe(registry);
  });
});
