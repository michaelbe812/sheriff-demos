/**
 * Adapter `nx-plugin-openapi` (@nx-plugin-openapi/core + plugin-openapi | plugin-hey-api), without an Nx
 * executor context: the package's generator plugins directly via its GeneratorRegistry (spike S2).
 *
 * options:
 *   plugin                'openapi-tools' (default) | 'hey-api'
 *   generatorOptions      passed 1:1 to the plugin
 *   additionalProperties  openapi-tools only: typescript-angular options. plugin-openapi has no
 *                         --additional-properties, so they go into a config file (-c) in the tmp folder.
 *
 * Output = the direct adapters' output, their classification is reused.
 * Pitfalls: ctx.root = workspace root and outputPath relative to it (plugin-openapi starts
 * node_modules/@openapitools/openapi-generator-cli/main.js relative to root); the plugin empties the output
 * folder; hey-api needs an absolute spec path; the packages pin @nx/devkit 19 (peer warning under Nx 23).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { classifyHeyApi, defaults as heyApiDefaults } from './hey-api.mjs';
import { classifyOpenApiTools, defaults as openapiToolsDefaults } from './openapi-tools.mjs';

const require = createRequire(import.meta.url);

export const defaults = { plugin: 'openapi-tools' };

const pluginDefaults = {
  // modelPackage/apiPackage fixed: the classification depends on them (plugin-openapi has flags for it)
  'openapi-tools': { modelPackage: 'model', apiPackage: 'api' },
  'hey-api': { plugins: heyApiDefaults.plugins, logs: { level: 'silent', file: false } },
};

/** @type {import('../contract').GeneratorAdapter} */
export default {
  id: 'nx-plugin-openapi',
  async generate({ specFile, outDir, options, workspaceRoot }) {
    const pluginId = options.plugin;
    if (!(pluginId in pluginDefaults)) throw new Error(`nx-plugin-openapi: unknown plugin '${pluginId}'`);
    const generatorOptions = { ...pluginDefaults[pluginId], ...(options.generatorOptions ?? {}) };
    if (pluginId === 'openapi-tools' && !generatorOptions.configFile) {
      const configFile = join(dirname(outDir), 'openapi-tools.config.json');
      mkdirSync(dirname(configFile), { recursive: true });
      writeFileSync(
        configFile,
        JSON.stringify({ ...openapiToolsDefaults, ...(options.additionalProperties ?? {}) }, null, 2),
      );
      generatorOptions.configFile = configFile;
    }
    const { GeneratorRegistry, loadPlugin } = require('@nx-plugin-openapi/core');
    const registry = GeneratorRegistry.instance();
    if (!registry.has(pluginId)) registry.register(await loadPlugin(pluginId, { root: workspaceRoot }));
    const plugin = registry.get(pluginId);
    const pluginOptions = { inputSpec: specFile, outputPath: relative(workspaceRoot, outDir), generatorOptions };
    await plugin.validate?.(pluginOptions);
    const result = await plugin.generate(pluginOptions, { root: workspaceRoot });
    if (result && result.success === false)
      throw new Error(`nx-plugin-openapi/${pluginId}: ${result.message ?? 'failed'}`);
  },
  // ctx instead of outDir only: which plugin ran is in the options (contract refinement from S2)
  async classify({ outDir, options }) {
    return options.plugin === 'hey-api' ? classifyHeyApi(outDir) : classifyOpenApiTools(outDir);
  },
};
