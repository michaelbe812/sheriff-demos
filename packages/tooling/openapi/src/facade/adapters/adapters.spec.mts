/**
 * Adapter edge cases without running a generator: nx-plugin-openapi against a stub plugin in its registry
 * (options passed through, config file, failed result), openapi-tools without the cli. The real runs of all
 * adapters: test/integration/facade.spec.mts.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyHeyApi } from './hey-api.mjs';
import nxPluginOpenapi from './nx-plugin-openapi.mjs';
import openapiTools, { classifyOpenApiTools } from './openapi-tools.mjs';

const { GeneratorRegistry } = createRequire(import.meta.url)('@nx-plugin-openapi/core');

describe('nx-plugin-openapi adapter (stub backend)', () => {
  let root: string;
  const registry = GeneratorRegistry.instance();
  interface PluginCall {
    options: {
      inputSpec: string;
      outputPath: string;
      generatorOptions: Record<string, unknown> & { configFile?: string };
    };
    context: unknown;
  }
  const calls: PluginCall[] = [];
  let result: unknown;
  const stub = (name: string, withValidate = true) => ({
    name,
    ...(withValidate ? { validate: async () => undefined } : {}),
    generate: async (options: PluginCall['options'], context: unknown) => {
      calls.push({ options, context });
      return result;
    },
  });
  const context = (options: Record<string, unknown>) => ({
    specFile: join(root, 'libs/generated/x/openapi.yaml'),
    outDir: join(root, 'tmp/openapi/generated/x/raw'),
    options,
    workspaceRoot: root,
    client: {
      name: 'x',
      placement: 'shared' as const,
      spec: { file: 'libs/generated/x/openapi.yaml' },
      generator: { adapter: 'nx-plugin-openapi' },
    },
  });
  let saved: Map<string, unknown>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nx-plugin-openapi-'));
    saved = new Map(registry.plugins);
    calls.length = 0;
    result = undefined;
  });
  afterEach(() => {
    registry.plugins = saved;
    rmSync(root, { recursive: true, force: true });
  });

  it('openapi-tools backend: fixed packages, additionalProperties into a generated config file, relative output', async () => {
    registry.register(stub('openapi-tools'));
    await nxPluginOpenapi.generate(context({ plugin: 'openapi-tools', additionalProperties: { providedIn: 'any' } }));
    const [{ options, context: pluginContext }] = calls;
    expect(options).toMatchObject({
      inputSpec: join(root, 'libs/generated/x/openapi.yaml'),
      outputPath: 'tmp/openapi/generated/x/raw',
      generatorOptions: {
        modelPackage: 'model',
        apiPackage: 'api',
        configFile: join(root, 'tmp/openapi/generated/x/openapi-tools.config.json'),
      },
    });
    expect(pluginContext).toEqual({ root });
    expect(JSON.parse(readFileSync(options.generatorOptions.configFile as string, 'utf-8'))).toMatchObject({
      providedIn: 'any',
      fileNaming: 'kebab-case',
    });
  });

  it('an own configFile is kept, generatorOptions pass through; hey-api backend gets its plugins', async () => {
    registry.register(stub('openapi-tools', false));
    await nxPluginOpenapi.generate(
      context({ plugin: 'openapi-tools', generatorOptions: { configFile: 'own.json', skipValidateSpec: true } }),
    );
    expect(calls[0].options.generatorOptions).toEqual({
      modelPackage: 'model',
      apiPackage: 'api',
      configFile: 'own.json',
      skipValidateSpec: true,
    });
    expect(existsSync(join(root, 'tmp/openapi/generated/x/openapi-tools.config.json'))).toBe(false);

    registry.register(stub('hey-api'));
    await nxPluginOpenapi.generate(context({ plugin: 'hey-api' }));
    expect(calls[1].options.generatorOptions.plugins).toContain('@hey-api/client-angular');
  });

  it('a failed plugin result is an error (with and without message)', async () => {
    registry.register(stub('openapi-tools'));
    result = { success: false, message: 'spec invalid' };
    await expect(nxPluginOpenapi.generate(context({ plugin: 'openapi-tools' }))).rejects.toThrow(
      'nx-plugin-openapi/openapi-tools: spec invalid',
    );
    result = { success: false };
    await expect(nxPluginOpenapi.generate(context({ plugin: 'openapi-tools' }))).rejects.toThrow(
      'nx-plugin-openapi/openapi-tools: failed',
    );
    result = { success: true };
    await expect(nxPluginOpenapi.generate(context({ plugin: 'openapi-tools' }))).resolves.toBeUndefined();
  });

  it('classify follows the backend (ctx.options.plugin)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'raw-'));
    try {
      expect(await nxPluginOpenapi.classify({ ...context({ plugin: 'hey-api' }), outDir })).toEqual(
        classifyHeyApi(outDir),
      );
      expect(await nxPluginOpenapi.classify({ ...context({ plugin: 'openapi-tools' }), outDir })).toEqual(
        classifyOpenApiTools(outDir),
      );
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});

describe('openapi-tools adapter', () => {
  it('without the cli in the workspace: error with hint, no output of the (not started) process', async () => {
    const root = mkdtempSync(join(tmpdir(), 'no-cli-'));
    try {
      await expect(
        openapiTools.generate({
          specFile: join(root, 'x.yaml'),
          outDir: join(root, 'raw'),
          options: {},
          workspaceRoot: root,
        } as never),
      ).rejects.toThrow(
        /^openapi-generator-cli failed \(Java 11\+ in PATH\? network for the first jar download\?\):\n$/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
