/**
 * Adapter c) nx-plugin-openapi (@nx-plugin-openapi/core + plugin-openapi | plugin-hey-api), ohne Nx-Executor-Kontext:
 * die Generator-Plugins des Pakets direkt über die GeneratorRegistry. Vorlage: Spike S2.
 *
 * options:
 *   plugin                'openapi-tools' (Default) | 'hey-api'
 *   generatorOptions      1:1 an das Plugin
 *   additionalProperties  nur openapi-tools: typescript-angular-Optionen. plugin-openapi kennt kein
 *                         --additional-properties, deshalb als Config-Datei (-c) im tmp-Ordner.
 *
 * Die Ausgabe ist dieselbe wie bei den direkten Adaptern, die Klassifizierung wird wiederverwendet.
 * Fallstricke: ctx.root = Workspace-Root und outputPath relativ dazu (plugin-openapi startet
 * node_modules/@openapitools/openapi-generator-cli/main.js relativ zu root); das Plugin leert den Ausgabeordner;
 * hey-api braucht einen absoluten Spec-Pfad; die Pakete bringen @nx/devkit 19 fest mit (Peer-Warnung unter Nx 23).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { classifyHeyApi, defaults as heyApiDefaults } from './hey-api.mjs';
import { classifyOpenApiTools, defaults as openapiToolsDefaults } from './openapi-tools.mjs';

const require = createRequire(import.meta.url);

export const defaults = { plugin: 'openapi-tools' };

const pluginDefaults = {
  // modelPackage/apiPackage fest: die Klassifizierung hängt daran (plugin-openapi hat Flags dafür)
  'openapi-tools': { modelPackage: 'model', apiPackage: 'api' },
  'hey-api': { plugins: heyApiDefaults.plugins, logs: { level: 'silent', file: false } },
};

/** @type {import('../contract').GeneratorAdapter} */
export default {
  id: 'nx-plugin-openapi',
  async generate({ specFile, outDir, options, workspaceRoot }) {
    const pluginId = options.plugin;
    if (!(pluginId in pluginDefaults)) throw new Error(`nx-plugin-openapi: unbekanntes plugin '${pluginId}'`);
    const generatorOptions = { ...pluginDefaults[pluginId], ...(options.generatorOptions ?? {}) };
    if (pluginId === 'openapi-tools' && !generatorOptions.configFile) {
      const configFile = join(dirname(outDir), 'openapi-tools.config.json');
      mkdirSync(dirname(configFile), { recursive: true });
      writeFileSync(configFile, JSON.stringify({ ...openapiToolsDefaults, ...(options.additionalProperties ?? {}) }, null, 2));
      generatorOptions.configFile = configFile;
    }
    const { GeneratorRegistry, loadPlugin } = require('@nx-plugin-openapi/core');
    const registry = GeneratorRegistry.instance();
    if (!registry.has(pluginId)) registry.register(await loadPlugin(pluginId, { root: workspaceRoot }));
    const plugin = registry.get(pluginId);
    const pluginOptions = { inputSpec: specFile, outputPath: relative(workspaceRoot, outDir), generatorOptions };
    await plugin.validate?.(pluginOptions);
    const result = await plugin.generate(pluginOptions, { root: workspaceRoot });
    if (result && result.success === false) throw new Error(`nx-plugin-openapi/${pluginId}: ${result.message ?? 'fehlgeschlagen'}`);
  },
  // ctx statt nur outDir: welches Plugin lief, steht in den Optionen (Vertragsverfeinerung aus S2)
  async classify({ outDir, options }) {
    return options.plugin === 'hey-api' ? classifyHeyApi(outDir) : classifyOpenApiTools(outDir);
  },
};
