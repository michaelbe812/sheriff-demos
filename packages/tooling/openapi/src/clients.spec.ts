import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addClientEntry,
  clientExportPrefix,
  readClientsJson,
  relocateClientProject,
  renameClientExports,
  updateClientEntries,
  writeClientsJson,
} from './clients';

const read = (tree: Tree, path: string) => tree.read(path, 'utf-8');
const clients = (tree: Tree) => JSON.parse(read(tree, 'openapi-clients.json') ?? '{}').clients;

describe('openapi-clients.json on the Tree', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('defaults without file; add keeps key order, 2 spaces + newline', () => {
    expect(readClientsJson(tree)).toEqual({
      $schema: './packages/tooling/openapi/openapi-clients.schema.json',
      defaultAdapter: 'openapi-tools',
      clients: {},
    });
    addClientEntry(tree, 'generated/b-client', {});
    addClientEntry(tree, 'generated/a-client', { url: 'https://a' });
    expect(read(tree, 'openapi-clients.json')).toBe(
      [
        '{',
        '  "$schema": "./packages/tooling/openapi/openapi-clients.schema.json",',
        '  "defaultAdapter": "openapi-tools",',
        '  "clients": {',
        '    "generated/b-client": {},',
        '    "generated/a-client": {',
        '      "url": "https://a"',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('an existing file is read as is', () => {
    writeClientsJson(tree, { clients: { 'generated/x-client': { adapter: 'hey-api' } } });
    expect(readClientsJson(tree)).toEqual({ clients: { 'generated/x-client': { adapter: 'hey-api' } } });
  });

  it('move: every client at or below the path is renamed; a part path or another client is untouched', () => {
    expect(updateClientEntries(tree, 'booking', 'billing')).toEqual([]);
    writeClientsJson(tree, {
      clients: {
        'booking/generated/a-client': { url: 'https://a' },
        'booking/generated/b-client': {},
        'bookings/generated/c-client': {},
        'generated/d-client': {},
      },
    });
    expect(updateClientEntries(tree, 'booking/generated/a-client/api', 'booking/generated/a-client/x')).toEqual([]);
    expect(updateClientEntries(tree, 'booking', 'billing')).toEqual([
      ['booking/generated/a-client', 'billing/generated/a-client'],
      ['booking/generated/b-client', 'billing/generated/b-client'],
    ]);
    expect(clients(tree)).toEqual({
      'billing/generated/a-client': { url: 'https://a' },
      'billing/generated/b-client': {},
      'bookings/generated/c-client': {},
      'generated/d-client': {},
    });
  });

  it('remove: entries at or below the path are dropped', () => {
    writeClientsJson(tree, { clients: { 'generated/d-client': {}, 'booking/generated/a-client': {} } });
    expect(updateClientEntries(tree, 'generated/d-client')).toEqual([['generated/d-client', undefined]]);
    expect(clients(tree)).toEqual({ 'booking/generated/a-client': {} });
    writeClientsJson(tree, {});
    expect(updateClientEntries(tree, 'generated')).toEqual([]);
  });

  it('client name → export prefix', () => {
    expect(clientExportPrefix('pet-client')).toBe('petClient');
    expect(clientExportPrefix('v2-api-client')).toBe('v2ApiClient');
  });

  it('a renamed client renames <client>Http/Handlers/BaseUrl in apps/ and libs/', () => {
    tree.write(
      'libs/booking/api/src/a.spec.ts',
      'import { demoClientHttp, demoClientHandlers, demoClientBaseUrl, demoClientX } from "x";\n',
    );
    tree.write('apps/client/src/main.ts', 'const u = demoClientBaseUrl;\n');
    tree.write('libs/booking/api/src/b.ts', 'export const other = 1;\n');

    expect(renameClientExports(tree, 'generated/demo-client', 'booking/generated/thing-client')).toEqual([
      'apps/client/src/main.ts',
      'libs/booking/api/src/a.spec.ts',
    ]);
    expect(read(tree, 'libs/booking/api/src/a.spec.ts')).toBe(
      'import { thingClientHttp, thingClientHandlers, thingClientBaseUrl, demoClientX } from "x";\n',
    );
    expect(read(tree, 'apps/client/src/main.ts')).toBe('const u = thingClientBaseUrl;\n');
  });

  it('no rename for the same name, a non-client path or a moved (not renamed) client', () => {
    tree.write('libs/booking/api/src/a.ts', 'demoClientHttp;\n');
    expect(renameClientExports(tree, 'generated/demo-client', 'booking/generated/demo-client')).toEqual([]);
    expect(renameClientExports(tree, 'booking/api', 'booking/generated/x-client')).toEqual([]);
    expect(renameClientExports(tree, 'generated/demo-client', 'booking/state')).toEqual([]);
    expect(read(tree, 'libs/booking/api/src/a.ts')).toBe('demoClientHttp;\n');
  });

  it('relocateClientProject: name, $schema, scope tag, paths in the targets; no-op without project.json', () => {
    tree.write(
      'libs/booking/generated/x-client/project.json',
      JSON.stringify({
        name: 'generated-x-client',
        $schema: '../../../node_modules/nx/schemas/project-schema.json',
        tags: ['scope:shared', 'generated'],
        targets: {
          generate: {
            inputs: ['{workspaceRoot}/libs/generated/x-client/openapi.yaml'],
            options: { client: 'generated/x-client' },
          },
        },
      }),
    );
    expect(relocateClientProject(tree, 'generated/x-client', 'booking/generated/x-client')).toBe(
      'booking-generated-x-client',
    );
    expect(JSON.parse(read(tree, 'libs/booking/generated/x-client/project.json') ?? '')).toEqual({
      name: 'booking-generated-x-client',
      $schema: '../../../../node_modules/nx/schemas/project-schema.json',
      tags: ['scope:booking', 'generated'],
      targets: {
        generate: {
          inputs: ['{workspaceRoot}/libs/booking/generated/x-client/openapi.yaml'],
          options: { client: 'booking/generated/x-client' },
        },
      },
    });
    expect(relocateClientProject(tree, 'generated/y-client', 'generated/z-client')).toBe('generated-z-client');
    expect(tree.exists('libs/generated/z-client/project.json')).toBe(false);
  });
});
