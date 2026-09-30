/**
 * Executors with an Nx-like executor context in a fixture workspace: generate, generate-testing and
 * update-spec (local HTTP server as URL source: updated / unchanged / errors, normalization), plus the
 * adapter failure modes (generator process fails, Java missing).
 */
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import generateExecutor from '../../src/executors/generate.js';
import generateTestingExecutor from '../../src/executors/generate-testing.js';
import updateSpecExecutor from '../../src/executors/update-spec.js';
import { generateClient, resolveClient } from '../../src/facade/facade.mjs';
import {
  addClient,
  createWorkspace,
  executorContext,
  filesBelow,
  read,
  removeWorkspace,
  startSpecServer,
  THINGS_SPEC,
  write,
} from '../helpers.mjs';

describe('executors', () => {
  let root: string;
  let server: Awaited<ReturnType<typeof startSpecServer>>;
  let served: { status: number; body: string };

  beforeAll(async () => {
    root = createWorkspace('executors');
    // prettier config as in the workspace: update-spec formats like the generators' formatFiles
    write(root, '.prettierrc', '{ "singleQuote": true, "printWidth": 120 }\n');
    server = await startSpecServer(() => served);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(async () => {
    await server.close();
    removeWorkspace(root);
    vi.restoreAllMocks();
  });

  it('generate: runs the configured adapter for the client of its option', async () => {
    addClient(root, 'generated/things-client', { entry: { adapter: 'hey-api' } });
    const result = await generateExecutor(
      { client: 'generated/things-client' },
      executorContext(root, 'generated-things-client', 'generate'),
    );
    expect(result).toEqual({ success: true });
    expect(filesBelow(join(root, 'libs/generated/things-client/types/src/generated'))).toContain('types.gen.ts');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('generated-things-client: hey-api → {"types":1'));
  });

  it('generate: reports failure (no entry) instead of throwing', async () => {
    const result = await generateExecutor(
      { client: 'generated/missing-client' },
      executorContext(root, 'x', 'generate'),
    );
    expect(result).toEqual({ success: false });
    expect(console.error).toHaveBeenCalledWith('openapi-clients.json has no entry "generated/missing-client"');
  });

  it('generate-testing: the testing lib from the spec only', async () => {
    const result = await generateTestingExecutor(
      { client: 'generated/things-client' },
      executorContext(root, 'generated-things-client-testing', 'generate'),
    );
    expect(result).toEqual({ success: true });
    expect(existsSync(join(root, 'libs/generated/things-client/testing/src/generated/handlers.ts'))).toBe(true);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringMatching(/generated-things-client-testing: \d+ files \(baseUrl "http:\/\/api.test\/v1"\)/),
    );
  });

  it('generate-testing: reports failure', async () => {
    expect(
      await generateTestingExecutor({ client: 'generated/missing-client' }, executorContext(root, 'x', 'generate')),
    ).toEqual({
      success: false,
    });
  });

  it('update-spec: downloads the url, writes it normalized (YAML + source header, prettier), then "unchanged"', async () => {
    served = {
      status: 200,
      body: JSON.stringify({ openapi: '3.0.3', info: { title: 'Remote', version: '1' }, paths: { '/r': {} } }),
    };
    addClient(root, 'generated/remote-client', { entry: { url: server.url('/remote.json') } });
    const context = executorContext(root, 'generated-remote-client', 'update-spec');

    expect(await updateSpecExecutor({ client: 'generated/remote-client' }, context)).toEqual({ success: true });
    const spec = read(root, 'libs/generated/remote-client/openapi.yaml');
    expect(spec).toBe(
      [
        `# Source: ${server.url('/remote.json')}`,
        '# Update: nx run generated-remote-client:update-spec (overwrites this file, normalized). Committed, the only source for generate.',
        'openapi: 3.0.3',
        'info:',
        '  title: Remote',
        "  version: '1'",
        'paths:',
        '  /r: {}',
        '',
      ].join('\n'),
    );
    expect(console.log).toHaveBeenCalledWith(
      `libs/generated/remote-client/openapi.yaml: updated (${server.url('/remote.json')})`,
    );

    expect(await updateSpecExecutor({ client: 'generated/remote-client' }, context)).toEqual({ success: true });
    expect(read(root, 'libs/generated/remote-client/openapi.yaml')).toBe(spec);
    expect(console.log).toHaveBeenCalledWith(
      `libs/generated/remote-client/openapi.yaml: unchanged (${server.url('/remote.json')})`,
    );
  });

  it('update-spec: a JSON spec file stays JSON (formatted)', async () => {
    served = { status: 200, body: 'openapi: 3.1.0\ninfo: { title: J, version: "2" }\npaths: {}\n' };
    addClient(root, 'generated/json-client', {
      specFile: 'openapi.json',
      spec: '{}',
      entry: { url: server.url('/j.yaml') },
    });
    expect(
      await updateSpecExecutor({ client: 'generated/json-client' }, executorContext(root, 'p', 'update-spec')),
    ).toEqual({ success: true });
    expect(read(root, 'libs/generated/json-client/openapi.json')).toBe(
      '{\n  "openapi": "3.1.0",\n  "info": {\n    "title": "J",\n    "version": "2"\n  },\n  "paths": {}\n}\n',
    );
  });

  it('update-spec: HTTP error, no url, unreachable server → failure, spec untouched', async () => {
    const before = read(root, 'libs/generated/remote-client/openapi.yaml');
    served = { status: 500, body: 'boom' };
    expect(
      await updateSpecExecutor({ client: 'generated/remote-client' }, executorContext(root, 'p', 'update-spec')),
    ).toEqual({ success: false });
    expect(console.error).toHaveBeenCalledWith(`GET ${server.url('/remote.json')}: 500`);

    expect(
      await updateSpecExecutor({ client: 'generated/things-client' }, executorContext(root, 'p', 'update-spec')),
    ).toEqual({ success: false });
    expect(console.error).toHaveBeenCalledWith('things-client: no url (openapi-clients.json → clients → <path> → url)');

    addClient(root, 'generated/offline-client', { entry: { url: 'http://127.0.0.1:1/unreachable.yaml' } });
    expect(
      await updateSpecExecutor({ client: 'generated/offline-client' }, executorContext(root, 'p', 'update-spec')),
    ).toEqual({ success: false });
    expect(read(root, 'libs/generated/remote-client/openapi.yaml')).toBe(before);
  });
});

describe('adapter failure modes', () => {
  let root: string;
  beforeAll(() => {
    root = createWorkspace('adapter-errors');
  });
  afterAll(() => removeWorkspace(root));

  it('openapi-tools: the generator process fails (invalid spec) → error with its output', async () => {
    addClient(root, 'generated/broken-client', {
      // info.version missing: the generator's spec validation fails (exit 1)
      spec: 'openapi: 3.0.3\ninfo: { title: Broken }\npaths:\n  /x:\n    get:\n      responses: {}\n',
    });
    await expect(generateClient(resolveClient(root, 'generated/broken-client'), root)).rejects.toThrow(
      /openapi-generator-cli failed \(Java 11\+ in PATH\? network for the first jar download\?\):\n[\s\S]*org\.openapitools\.codegen/,
    );
  });

  it('openapi-tools: Java missing (simulated by a `java` that is not found) → hint on Java', async () => {
    addClient(root, 'generated/java-client');
    const fakeBin = join(root, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    const called = join(fakeBin, 'called');
    writeFileSync(
      join(fakeBin, 'java'),
      `#!/bin/sh\ntouch "${called}"\necho "java: command not found" >&2\nexit 127\n`,
    );
    chmodSync(join(fakeBin, 'java'), 0o755);
    const path = process.env['PATH'];
    process.env['PATH'] = `${fakeBin}:${path}`;
    try {
      await expect(generateClient(resolveClient(root, 'generated/java-client'), root)).rejects.toThrow(
        'openapi-generator-cli failed (Java 11+ in PATH? network for the first jar download?)',
      );
      // the cli really started `java` (ours) and failed on it
      expect(existsSync(called)).toBe(true);
    } finally {
      process.env['PATH'] = path;
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('hey-api: an invalid spec fails the generation', async () => {
    addClient(root, 'generated/bad-hey-client', { spec: 'not: [a, spec\n', entry: { adapter: 'hey-api' } });
    await expect(generateClient(resolveClient(root, 'generated/bad-hey-client'), root)).rejects.toThrow();
  });

  it('nx-plugin-openapi: unknown backend plugin', async () => {
    addClient(root, 'generated/np-client', { entry: { adapter: 'nx-plugin-openapi', options: { plugin: 'swagger' } } });
    await expect(generateClient(resolveClient(root, 'generated/np-client'), root)).rejects.toThrow(
      "nx-plugin-openapi: unknown plugin 'swagger'",
    );
  });

  it('the spec file must exist', async () => {
    addClient(root, 'generated/gone-client', { spec: THINGS_SPEC });
    const client = resolveClient(root, 'generated/gone-client');
    rmSync(join(root, client.spec.file));
    await expect(generateClient(client, root)).rejects.toThrow('libs/generated/gone-client/openapi.yaml missing');
  });
});
