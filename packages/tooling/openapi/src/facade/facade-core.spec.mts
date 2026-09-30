/**
 * Facade core on synthetic raw output (no generator): split + import rewriting, barrels with duplicate
 * names, client resolution, registry, spec serialization. The adapters themselves: test/integration.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBarrel } from './barrel.mjs';
import { clientRoot, generatedHeader, loadAdapter, partAlias, resolveClient, serializeSpec } from './facade.mjs';
import { splitIntoParts } from './split.mjs';

let dir: string;
const write = (path: string, content: string): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'openapi-facade-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ALIASES = {
  types: '@blueprint/generated/x/types',
  api: '@blueprint/generated/x/api',
  core: '@blueprint/generated/x/core',
};

describe('splitIntoParts', () => {
  it('keeps the folder structure, rewrites every kind of relative specifier into another part, keeps the quote', () => {
    write('model/pet.ts', 'export interface Pet { id: string }\n');
    write('model/index.ts', "export * from './pet';\n");
    write('base.ts', 'export const BASE = "/";\n');
    write(
      'api/pets.ts',
      [
        'import { Pet } from "../model/pet";',
        "import type { Pet as P } from '../model';",
        "export { BASE } from '../base.js';",
        "export { Pet as Animal } from '../model/pet.ts';",
        "type T = import('../model/pet').Pet;",
        "const lazy = () => import('../base');",
        "import { helper } from './helper';",
        "import { dynamic } from 'rxjs';",
        'const notStatic = (name: string) => import(name);',
        'export { helper };',
        '',
      ].join('\n'),
    );
    write('api/helper.ts', 'export const helper = 1;\n');
    const parts = splitIntoParts({
      rawDir: dir,
      classification: {
        models: ['model/pet.ts', 'model/index.ts'],
        apis: ['api/pets.ts', 'api/helper.ts'],
        core: ['base.ts'],
      },
      aliases: ALIASES,
      allFiles: ['api/helper.ts', 'api/pets.ts', 'base.ts', 'model/index.ts', 'model/pet.ts'],
    });
    expect(parts.api.files.map((file) => file.path)).toEqual(['api/helper.ts', 'api/pets.ts']);
    expect(parts.api.files[1].content).toBe(
      [
        'import { Pet } from "@blueprint/generated/x/types";',
        "import type { Pet as P } from '@blueprint/generated/x/types';",
        "export { BASE } from '@blueprint/generated/x/core';",
        "export { Pet as Animal } from '@blueprint/generated/x/types';",
        "type T = import('@blueprint/generated/x/types').Pet;",
        "const lazy = () => import('@blueprint/generated/x/core');",
        "import { helper } from './helper';",
        "import { dynamic } from 'rxjs';",
        'const notStatic = (name: string) => import(name);',
        'export { helper };',
        '',
      ].join('\n'),
    );
    // no declared entries: every file of the part, sorted
    expect(parts.types.entries).toEqual(['model/index.ts', 'model/pet.ts']);
    expect(parts.core).toEqual({
      files: [{ path: 'base.ts', content: 'export const BASE = "/";\n' }],
      entries: ['base.ts'],
    });
  });

  it('a classification may leave out categories', () => {
    write('m.ts', 'export type M = 1;\n');
    const parts = splitIntoParts({
      rawDir: dir,
      classification: { models: ['m.ts'] },
      aliases: ALIASES,
      allFiles: ['m.ts'],
    });
    expect(parts.types.entries).toEqual(['m.ts']);
    expect(parts.core.files).toEqual([]);
  });

  it('declared entries keep their order; .d.ts targets resolve', () => {
    write('a.ts', "export type { X } from './x';\n");
    write('x.d.ts', 'export interface X {}\n');
    write('b.ts', 'export const b = 1;\n');
    const parts = splitIntoParts({
      rawDir: dir,
      classification: { models: ['x.d.ts', 'a.ts', 'b.ts'], apis: [], core: [], entries: { types: ['b.ts', 'a.ts'] } },
      aliases: ALIASES,
      allFiles: ['a.ts', 'b.ts', 'x.d.ts'],
    });
    expect(parts.types.entries).toEqual(['b.ts', 'a.ts']);
    expect(parts.api).toEqual({ files: [], entries: [] });
  });

  it('rejects double classification, a root index.ts, dropped targets, unknown targets and foreign entries', () => {
    write('a.ts', "import { b } from './b';\n");
    write('b.ts', 'export const b = 1;\n');
    write('c.ts', "import { z } from './zzz';\n");
    const split =
      (classification: object, allFiles = ['a.ts', 'b.ts', 'c.ts']) =>
      () =>
        splitIntoParts({
          rawDir: dir,
          classification: { models: [], apis: [], core: [], ...classification },
          aliases: ALIASES,
          allFiles,
        });

    expect(split({ models: ['b.ts'], core: ['b.ts'] })).toThrow('b.ts: classified in several categories');
    expect(split({ core: ['index.ts'] })).toThrow('index.ts: root index.ts is reserved (the facade writes the barrel)');
    expect(split({ apis: ['a.ts'] })).toThrow("a.ts: Import './b' points to a dropped or unknown file (b.ts)");
    expect(split({ apis: ['c.ts'] })).toThrow("c.ts: Import './zzz' points to a dropped or unknown file (not found)");
    expect(split({ models: ['b.ts'], entries: { types: ['b.ts', 'a.ts'] } })).toThrow(
      'entries.types: a.ts not in this part',
    );
  });
});

describe('buildBarrel', () => {
  it('no entries → empty module', () => {
    expect(buildBarrel(dir, [])).toBe('export {};');
  });

  it('first entry wins on duplicate names: later ones re-export the rest explicitly (values / types), default skipped', () => {
    write('client.gen.ts', 'export type Config = { a: 1 };\nexport const createClient = () => 1;\nexport default 1;\n');
    write(
      'client/index.ts',
      "export type { Config } from '../client.gen';\nexport { createClient } from '../client.gen';\nexport const other = 2;\nexport interface Extra {}\n",
    );
    write('only-types.ts', 'export type Config = 1;\nexport type Own = 2;\n');
    write('only-values.ts', 'export const other = 3;\nexport const mine = 4;\n');
    write('script.ts', 'const notAModule = 1;\n');
    expect(buildBarrel(dir, ['client.gen.ts', 'client/index.ts', 'only-types.ts', 'only-values.ts', 'script.ts'])).toBe(
      [
        "export * from './client.gen';",
        '// without Config, createClient: already exported by an earlier entry',
        "export { other } from './client/index';",
        "export type { Extra } from './client/index';",
        '// without Config: already exported by an earlier entry',
        "export type { Own } from './only-types';",
        '// without other: already exported by an earlier entry',
        "export { mine } from './only-values';",
      ].join('\n'),
    );
  });

  it('entries that are no module (empty generator barrel) are skipped', () => {
    write('model/models.ts', '');
    expect(buildBarrel(dir, ['model/models.ts'])).toBe('export {};');
  });
});

describe('client resolution + registry', () => {
  const config = (clients: object, defaultAdapter?: string) =>
    write('openapi-clients.json', JSON.stringify({ ...(defaultAdapter ? { defaultAdapter } : {}), clients }));

  it('placement, spec file, url, adapter fallback (entry → defaultAdapter → openapi-tools), options', () => {
    write('libs/generated/a-client/openapi.yaml', '');
    write('libs/booking/generated/b-client/openapi.json', '');
    config({
      'generated/a-client': { url: 'https://a', options: { x: 1 } },
      'booking/generated/b-client': { adapter: 'hey-api' },
    });
    expect(resolveClient(dir, 'generated/a-client')).toEqual({
      name: 'a-client',
      placement: 'shared',
      spec: { file: 'libs/generated/a-client/openapi.yaml', url: 'https://a' },
      generator: { adapter: 'openapi-tools', options: { x: 1 } },
    });
    expect(resolveClient(dir, 'booking/generated/b-client')).toEqual({
      name: 'b-client',
      placement: { domain: 'booking' },
      spec: { file: 'libs/booking/generated/b-client/openapi.json' },
      generator: { adapter: 'hey-api', options: {} },
    });
    config({ 'generated/a-client': {} }, 'nx-plugin-openapi');
    expect(resolveClient(dir, 'generated/a-client').generator.adapter).toBe('nx-plugin-openapi');
  });

  it('errors: no entry, no spec, two specs', () => {
    config({ 'generated/none-client': {}, 'generated/two-client': {} });
    expect(() => resolveClient(dir, 'generated/missing')).toThrow(
      'openapi-clients.json has no entry "generated/missing"',
    );
    expect(() => resolveClient(dir, 'generated/none-client')).toThrow(
      'libs/generated/none-client: needs exactly one spec',
    );
    write('libs/generated/two-client/openapi.yaml', '');
    write('libs/generated/two-client/openapi.json', '');
    expect(() => resolveClient(dir, 'generated/two-client')).toThrow(
      'libs/generated/two-client: needs exactly one spec',
    );
  });

  it('paths and aliases of a client', () => {
    expect(clientRoot({ name: 'a', placement: 'shared' })).toBe('libs/generated/a');
    expect(partAlias({ name: 'a', placement: { domain: 'booking' } }, 'api')).toBe(
      '@blueprint/booking/generated/a/api',
    );
    expect(generatedHeader('adapter x', 'libs/a/openapi.yaml')).toBe(
      '/* eslint-disable */\n/* eslint-enable @nx/enforce-module-boundaries, no-restricted-imports */\n// Generated by @blueprint/tooling (openapi, adapter x) from libs/a/openapi.yaml. Do not edit, do not commit.\n',
    );
  });

  it('loadAdapter: module + defaults per id; unknown ids and $-keys (comments) are rejected', async () => {
    const { adapter, defaults } = await loadAdapter('openapi-tools');
    expect(adapter.id).toBe('openapi-tools');
    expect(defaults).toMatchObject({ providedIn: 'root', fileNaming: 'kebab-case' });
    expect((await loadAdapter('hey-api')).adapter.id).toBe('hey-api');
    expect((await loadAdapter('nx-plugin-openapi')).defaults).toEqual({ plugin: 'openapi-tools' });
    await expect(loadAdapter('swagger')).rejects.toThrow(
      "Unknown adapter 'swagger'. Known: openapi-tools, hey-api, nx-plugin-openapi",
    );
    await expect(loadAdapter('$comment')).rejects.toThrow("Unknown adapter '$comment'");
  });
});

describe('serializeSpec', () => {
  const document = { openapi: '3.0.3', info: { title: 'T', version: '1' }, paths: {} };

  it('YAML with source header / JSON by extension, Prettier without config file = defaults', async () => {
    // tmpdir: no .prettierrc above → resolveConfig null → Prettier defaults
    expect(await serializeSpec(document, 'libs/generated/a/openapi.yaml', 'https://a', 'generated-a', dir)).toBe(
      '# Source: https://a\n# Update: nx run generated-a:update-spec (overwrites this file, normalized). Committed, the only source for generate.\nopenapi: 3.0.3\ninfo:\n  title: T\n  version: "1"\npaths: {}\n',
    );
    expect(await serializeSpec(document, 'libs/generated/a/openapi.json', 'https://a', 'generated-a', dir)).toBe(
      '{\n  "openapi": "3.0.3",\n  "info": {\n    "title": "T",\n    "version": "1"\n  },\n  "paths": {}\n}\n',
    );
  });

  it('without Prettier the text is returned unformatted', async () => {
    vi.resetModules();
    vi.doMock('prettier', () => {
      throw new Error('not installed');
    });
    const { serializeSpec: withoutPrettier } = await import('./facade.mjs');
    expect(await withoutPrettier(document, 'x/openapi.json', 'u', 'p', dir)).toBe(
      `${JSON.stringify(document, null, 2)}\n`,
    );
    vi.doUnmock('prettier');
  });
});

describe('generateClient with a stub adapter', () => {
  it('parts the adapter delivers nothing for and that have no lib are skipped; adapter without defaults', async () => {
    vi.resetModules();
    vi.doMock('./adapters/hey-api.mjs', () => ({
      // no defaults: the options are the client's only
      defaults: undefined,
      default: {
        id: 'hey-api',
        async generate({ outDir, options }: { outDir: string; options: object }) {
          writeFileSync(join(outDir, 'core.ts'), `export const options = ${JSON.stringify(options)};\n`);
        },
        async classify() {
          return { models: [], apis: [], core: ['core.ts'] };
        },
      },
    }));
    const { generateClient: generate } = await import('./facade.mjs');
    write('libs/generated/stub-client/openapi.yaml', 'openapi: 3.0.3\n');
    write('libs/generated/stub-client/core/src/index.ts', "export * from './generated';\n");
    const client = {
      name: 'stub-client',
      placement: 'shared' as const,
      spec: { file: 'libs/generated/stub-client/openapi.yaml' },
      generator: { adapter: 'hey-api', options: { a: 1 } },
    };
    expect(await generate(client, dir)).toEqual({ core: 1 });
    expect(readFileSync(join(dir, 'libs/generated/stub-client/core/src/generated/core.ts'), 'utf-8')).toContain(
      'export const options = {"a":1};',
    );
    vi.doUnmock('./adapters/hey-api.mjs');
  });
});

describe('updateSpec', () => {
  it('writes a spec file that does not exist yet (changed)', async () => {
    const { updateSpec } = await import('./facade.mjs');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('openapi: 3.0.3\ninfo: { title: T, version: "1" }\npaths: {}\n')),
    );
    const client = {
      name: 'n',
      placement: 'shared' as const,
      spec: { file: 'libs/generated/n/openapi.yaml', url: 'https://n' },
      generator: { adapter: 'hey-api' },
    };
    mkdirSync(join(dir, 'libs/generated/n'), { recursive: true });
    expect(await updateSpec(client, dir, 'generated-n')).toEqual({ changed: true });
    expect(readFileSync(join(dir, 'libs/generated/n/openapi.yaml'), 'utf-8')).toContain('# Source: https://n');
    vi.unstubAllGlobals();
  });
});
