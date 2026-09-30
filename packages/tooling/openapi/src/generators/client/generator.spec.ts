import { logger, type Tree } from '@nx/devkit';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlueprintTree, pathsOf, read, readProject } from '@blueprint/tooling-conventions/testing';
import { listLibPaths, readJsonFile } from '@blueprint/tooling-conventions/tree';
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

  it('writes the explicit config: client project.json, part configs with edges, paths entries', async () => {
    await clientGenerator(tree, { name: 'demo-client', spec: 'specs/demo.yaml', skipFormat: true });

    const client = readProject(tree, 'libs/generated/demo-client/project.json');
    expect(client).toMatchObject({ name: 'generated-demo-client', tags: ['scope:shared', 'generated'] });
    expect(client.targets.generate.options).toEqual({ client: 'generated/demo-client' });
    expect(client.targets['update-spec'].executor).toBe('@blueprint/tooling-openapi:update-spec');

    expect(readJsonFile(tree, 'libs/generated/demo-client/api/project.json')).toMatchObject({
      name: 'generated-demo-client-api',
      tags: ['scope:shared', 'type:api', 'feat:none', 'generated'],
      implicitDependencies: ['generated-demo-client', 'generated-demo-client-types', 'generated-demo-client-core'],
      targets: { build: {}, lint: {}, typecheck: {} },
    });
    // gitignored code: no peerDependencies (dist as before)
    expect(readJsonFile(tree, 'libs/generated/demo-client/api/package.json')).toEqual({
      name: '@blueprint/generated/demo-client/api',
      version: '0.0.1',
      private: true,
      sideEffects: false,
    });
    const testing = readProject(tree, 'libs/generated/demo-client/testing/project.json');
    expect(testing.targets.generate.executor).toBe('@blueprint/tooling-openapi:generate-testing');
    expect(testing.targets.lint).toEqual({ dependsOn: ['generate', '^generate'] });
    expect(tree.exists('libs/generated/demo-client/testing/package.json')).toBe(false);

    const paths = pathsOf(tree);
    for (const part of ['api', 'core', 'testing', 'types']) {
      expect(paths[`@blueprint/generated/demo-client/${part}`]).toEqual([
        `./libs/generated/demo-client/${part}/src/index.ts`,
      ]);
    }
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

  it('an existing openapi-clients.json without defaultAdapter: openapi-tools is the default', async () => {
    tree.write('openapi-clients.json', JSON.stringify({ clients: {} }));
    await clientGenerator(tree, {
      name: 'd-client',
      spec: 'specs/demo.yaml',
      adapter: 'openapi-tools',
      skipFormat: true,
    });
    expect(JSON.parse(read(tree, 'openapi-clients.json'))).toEqual({ clients: { 'generated/d-client': {} } });
  });

  it.each(['openapi-tools', 'hey-api', 'nx-plugin-openapi'])(
    'adapter %s: stored unless it is the default',
    async (adapter) => {
      await clientGenerator(tree, { name: 'a-client', spec: 'specs/demo.yaml', adapter, skipFormat: true });
      expect(clients(tree)['generated/a-client']).toEqual(adapter === 'openapi-tools' ? {} : { adapter });
    },
  );

  it('is idempotent: a second run fails before writing anything, the first result stays', async () => {
    await clientGenerator(tree, { name: 'demo-client', spec: 'specs/demo.yaml', skipFormat: true });
    const before = tree.listChanges().map((change) => [change.path, change.content?.toString()]);
    await expect(clientGenerator(tree, { name: 'demo-client', spec: 'specs/demo.yaml' })).rejects.toThrow(
      'exists already',
    );
    expect(tree.listChanges().map((change) => [change.path, change.content?.toString()])).toEqual(before);
  });

  it('validates the name, the entry and the spec', async () => {
    await expect(clientGenerator(tree, { name: 'DemoClient', spec: 'specs/demo.yaml' })).rejects.toThrow(
      'Client "DemoClient" must be kebab-case',
    );
    await expect(clientGenerator(tree, { name: 'generated', spec: 'specs/demo.yaml' })).rejects.toThrow(
      '"generated" is reserved.',
    );
    // entry left over without folder
    tree.write('openapi-clients.json', JSON.stringify({ clients: { 'generated/stale-client': {} } }));
    await expect(clientGenerator(tree, { name: 'stale-client', spec: 'specs/demo.yaml' })).rejects.toThrow(
      'openapi-clients.json has an entry "generated/stale-client" already',
    );
    tree.write('specs/broken.yaml', 'openapi: [3\n');
    await expect(clientGenerator(tree, { name: 'b-client', spec: 'specs/broken.yaml' })).rejects.toThrow(
      'specs/broken.yaml: no valid YAML/JSON',
    );
    tree.write('specs/empty.yaml', '');
    await expect(clientGenerator(tree, { name: 'e-client', spec: 'specs/empty.yaml' })).rejects.toThrow(
      'not an OpenAPI 3.x spec',
    );
    tree.write('specs/paths-missing.yaml', 'openapi: 3.0.3\n');
    await expect(clientGenerator(tree, { name: 'm-client', spec: 'specs/paths-missing.yaml' })).rejects.toThrow(
      'not an OpenAPI 3.x spec',
    );
    tree.write('specs/no-paths.yaml', 'openapi: 3.0.3\npaths: {}\n');
    await expect(clientGenerator(tree, { name: 'p-client', spec: 'specs/no-paths.yaml' })).rejects.toThrow(
      'not an OpenAPI 3.x spec with at least one path',
    );
  });

  it('domain "shared" = shared client; a domain path that is no client path is rejected', async () => {
    await clientGenerator(tree, { name: 'demo-client', domain: 'shared', spec: 'specs/demo.yaml', skipFormat: true });
    expect(clients(tree)).toEqual({ 'generated/demo-client': {} });

    // without scope list any slice folder counts as domain — a nested one yields no client path
    tree.delete('lib-scopes.json');
    tree.write('libs/a/b/types/src/index.ts', 'export {};\n');
    await expect(clientGenerator(tree, { name: 'x-client', domain: 'a/b', spec: 'specs/demo.yaml' })).rejects.toThrow(
      'libs/a/b/generated/x-client: not a client path',
    );
  });

  it('spec from a file outside the tree (absolute or workspace-relative), newline added', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'client-spec-'));
    try {
      writeFileSync(join(dir, 'abs.yaml'), SPEC_YAML.trimEnd());
      await clientGenerator(tree, { name: 'abs-client', spec: join(dir, 'abs.yaml'), skipFormat: true });
      expect(read(tree, 'libs/generated/abs-client/openapi.yaml')).toBe(SPEC_YAML);

      // relative, not in the tree: read from disk below tree.root
      const relative = join('..', 'abs.yaml');
      const treeInTmp = createBlueprintTree();
      Object.defineProperty(treeInTmp, 'root', { value: join(dir, 'ws') });
      await clientGenerator(treeInTmp, { name: 'rel-client', spec: relative, skipFormat: true });
      expect(read(treeInTmp, 'libs/generated/rel-client/openapi.yaml')).toBe(SPEC_YAML);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('URL: download errors are reported, an explicit url wins as update source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    await expect(clientGenerator(tree, { name: 'r-client', spec: 'https://example.org/missing.json' })).rejects.toThrow(
      'GET https://example.org/missing.json: 404',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('openapi: 3.0.3\ninfo: { title: t, version: "1" }\npaths: { /p: {} }\n')),
    );
    await clientGenerator(tree, {
      name: 'r-client',
      spec: 'https://mirror.example.org/api.yaml',
      url: 'https://example.org/api.yaml',
      skipFormat: true,
    });
    expect(read(tree, 'libs/generated/r-client/openapi.yaml')).toContain('# Source: https://example.org/api.yaml');
    expect(clients(tree)['generated/r-client']).toEqual({ url: 'https://example.org/api.yaml' });
  });

  it('a file spec with an explicit url: the file is committed as is, the url is the update source', async () => {
    await clientGenerator(tree, {
      name: 'f-client',
      spec: 'specs/demo.yaml',
      url: 'https://example.org/f.yaml',
      skipFormat: true,
    });
    expect(read(tree, 'libs/generated/f-client/openapi.yaml')).toBe(SPEC_YAML);
    expect(clients(tree)['generated/f-client']).toEqual({ url: 'https://example.org/f.yaml' });
  });

  it('formats (formatFiles) and tells how to generate and use the client', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const callback = await clientGenerator(tree, { name: 'demo-client', domain: 'booking', spec: 'specs/demo.yaml' });
    callback();
    expect(info.mock.calls.map(([message]) => message)).toEqual([
      'Client booking-generated-demo-client: libs/booking/generated/demo-client/{openapi.yaml,project.json,types,api,core,testing}, paths in tsconfig.base.json, entry in openapi-clients.json.',
      'Generate: nx run-many -t generate (build/lint/test/typecheck do it on their own).',
      'Use: @blueprint/booking/generated/demo-client/api (services) + /types in the booking api layer (the port), specs: @blueprint/booking/generated/demo-client/testing (demoClientHandlers, demoClientHttp).',
    ]);
    await clientGenerator(tree, { name: 'shared-client', spec: 'specs/demo.yaml', skipFormat: true }).then((done) =>
      done(),
    );
    expect(info).toHaveBeenLastCalledWith(expect.stringContaining('in the shared api layer'));
    info.mockRestore();
  });
});
