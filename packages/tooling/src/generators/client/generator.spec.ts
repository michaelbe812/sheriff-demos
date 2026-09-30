import type { Tree } from '@nx/devkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlueprintTree, read, scopesOf } from '@blueprint/tooling-conventions/testing';
import { moveGenerator } from '../move/generator';
import { removeGenerator } from '../remove/generator';
import { renameGenerator } from '../rename/generator';
import { listLibPaths } from '../shared/workspace';
import { clientGenerator } from './generator';

const SPEC_YAML = `openapi: 3.0.3
info: { title: Demo, version: 1.0.0 }
servers: [{ url: /api }]
paths:
  /things:
    get:
      operationId: listThings
      responses:
        '200': { description: OK }
`;
const clients = (tree: Tree) => JSON.parse(read(tree, 'openapi-clients.json')).clients;

describe('client generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
    tree.write('specs/demo.yaml', SPEC_YAML);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates a shared client: spec, four libs with only index.ts, entry', async () => {
    await clientGenerator(tree, { name: 'demo-client', spec: 'specs/demo.yaml', skipFormat: true });

    expect(read(tree, 'libs/generated/demo-client/openapi.yaml')).toBe(SPEC_YAML);
    expect(listLibPaths(tree, 'generated')).toEqual([
      'generated/demo-client/api',
      'generated/demo-client/core',
      'generated/demo-client/testing',
      'generated/demo-client/types',
    ]);
    expect(read(tree, 'libs/generated/demo-client/api/src/index.ts')).toBe("export * from './generated';\n");
    expect(clients(tree)).toEqual({ 'generated/demo-client': {} });
  });

  it('creates a domain client from a JSON spec, with url and a non-default adapter', async () => {
    tree.write(
      'specs/demo.json',
      JSON.stringify({ openapi: '3.1.0', info: { title: 'x', version: '1' }, paths: { '/x': {} } }),
    );
    await clientGenerator(tree, {
      name: 'booking-client',
      domain: 'booking',
      spec: 'specs/demo.json',
      url: 'https://example.org/openapi.json',
      adapter: 'hey-api',
      skipFormat: true,
    });

    expect(tree.exists('libs/booking/generated/booking-client/openapi.json')).toBe(true);
    expect(clients(tree)).toEqual({
      'booking/generated/booking-client': { url: 'https://example.org/openapi.json', adapter: 'hey-api' },
    });
  });

  it('downloads a URL once and normalizes it to YAML (url = source for update-spec)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ openapi: '3.0.3', info: { title: 't', version: '1' }, paths: { '/p': {} } })),
      ),
    );
    await clientGenerator(tree, { name: 'remote-client', spec: 'https://example.org/api.json', skipFormat: true });

    const spec = read(tree, 'libs/generated/remote-client/openapi.yaml');
    expect(spec).toContain('# Source: https://example.org/api.json');
    expect(spec).toContain('openapi: 3.0.3');
    expect(clients(tree)['generated/remote-client']).toEqual({ url: 'https://example.org/api.json' });
  });

  it('rejects an unknown domain, an existing client, no OpenAPI 3 spec and an unknown adapter', async () => {
    await expect(
      clientGenerator(tree, { name: 'x-client', domain: 'payment', spec: 'specs/demo.yaml' }),
    ).rejects.toThrow('Unknown scope "payment"');
    await clientGenerator(tree, { name: 'demo-client', spec: 'specs/demo.yaml', skipFormat: true });
    await expect(clientGenerator(tree, { name: 'demo-client', spec: 'specs/demo.yaml' })).rejects.toThrow(
      'exists already',
    );
    tree.write('specs/swagger.yaml', 'swagger: "2.0"\npaths: { /x: {} }\n');
    await expect(clientGenerator(tree, { name: 'old-client', spec: 'specs/swagger.yaml' })).rejects.toThrow(
      'not an OpenAPI 3.x spec',
    );
    await expect(
      clientGenerator(tree, { name: 'y-client', spec: 'specs/demo.yaml', adapter: 'swagger-codegen' }),
    ).rejects.toThrow('Unknown adapter');
  });

  it('remove takes the client and its entry out — openapi-clients.json exactly as before', async () => {
    await clientGenerator(tree, { name: 'keep-client', spec: 'specs/demo.yaml', skipFormat: true });
    const before = read(tree, 'openapi-clients.json');
    await clientGenerator(tree, { name: 'demo-client', domain: 'booking', spec: 'specs/demo.yaml', skipFormat: true });

    await removeGenerator(tree, { path: 'booking/generated/demo-client', skipFormat: true });

    expect(tree.exists('libs/booking/generated')).toBe(false);
    expect(read(tree, 'openapi-clients.json')).toBe(before);

    // `generated` is no scope: removing one of two shared clients leaves the scope list alone
    await clientGenerator(tree, { name: 'other-client', spec: 'specs/demo.yaml', skipFormat: true });
    await removeGenerator(tree, { path: 'generated/keep-client', skipFormat: true });
    expect(scopesOf(tree)).toEqual(['booking', 'layout', 'shared']);
  });

  it('remove refuses while a port imports the client', async () => {
    await clientGenerator(tree, { name: 'demo-client', domain: 'booking', spec: 'specs/demo.yaml', skipFormat: true });
    tree.write(
      'libs/booking/api/src/uses.ts',
      "import { DemoService } from '@blueprint/booking/generated/demo-client/api';\nexport const x = DemoService;\n",
    );

    await expect(removeGenerator(tree, { path: 'booking/generated/demo-client' })).rejects.toThrow(
      'libs/booking/api/src/uses.ts',
    );
  });

  it('move / rename keep the entry, the aliases and the generated testing exports in step', async () => {
    await clientGenerator(tree, {
      name: 'demo-client',
      spec: 'specs/demo.yaml',
      url: 'https://example.org/a.yaml',
      skipFormat: true,
    });
    tree.write(
      'libs/booking/api/src/booking-api.spec.ts',
      "import { demoClientHandlers, demoClientHttp } from '@blueprint/generated/demo-client/testing';\nexport const h = [demoClientHandlers, demoClientHttp];\n",
    );

    await moveGenerator(tree, { from: 'generated/demo-client', to: 'booking/generated/demo-client', skipFormat: true });
    expect(clients(tree)).toEqual({ 'booking/generated/demo-client': { url: 'https://example.org/a.yaml' } });
    expect(tree.exists('libs/booking/generated/demo-client/openapi.yaml')).toBe(true);

    await renameGenerator(tree, { path: 'booking/generated/demo-client', name: 'thing-client', skipFormat: true });
    expect(clients(tree)).toEqual({ 'booking/generated/thing-client': { url: 'https://example.org/a.yaml' } });
    expect(read(tree, 'libs/booking/api/src/booking-api.spec.ts')).toBe(
      "import { thingClientHandlers, thingClientHttp } from '@blueprint/booking/generated/thing-client/testing';\nexport const h = [thingClientHandlers, thingClientHttp];\n",
    );
  });

  it('removing a domain drops its clients', async () => {
    await clientGenerator(tree, { name: 'demo-client', domain: 'booking', spec: 'specs/demo.yaml', skipFormat: true });
    await removeGenerator(tree, { path: 'booking', force: true, skipFormat: true });
    expect(clients(tree)).toEqual({});
  });
});
