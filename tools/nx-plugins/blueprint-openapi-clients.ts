/**
 * Lokales Crystal-Plugin für generierte OpenAPI-Clients (Spike S1, docs/openapi-facade-spike.md).
 *
 *   marker     libs/generated/<client>/openapi.yaml, libs/<domain>/generated/<client>/openapi.yaml
 *   projekt    <pfad mit ->  (generated-pet-client), Tags scope:<shared|domain> + generated, kein Code
 *   targets    generate     ./tools/openapi-facade:generate, gecacht, Outputs = <teil>/src/generated
 *              update-spec  nur mit url, nicht gecacht
 *   optionen   nx.json → plugins → options:
 *                { defaultAdapter: 'openapi-tools',
 *                  clients: { 'generated/pet-client': { adapter?, url?, options? } } }
 *              Ein Client ohne Eintrag bekommt den defaultAdapter und kein update-spec.
 *
 * Die Teil-Libs (types/api/core) erkennt blueprint-libs.ts wie jede Lib an ihrer committeten src/index.ts.
 */
import type { CreateNodesV2, TargetConfiguration } from '@nx/devkit';
import { dirname } from 'node:path';
import { parseClientPath, projectNameFor, SPEC_FILE } from './generated-clients';

// sync lesbar (CJS): Cache-Inputs pro Adapter
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adapterRegistry: Record<string, { packages: string[]; inputs: string[]; runtime: string[] }> = require('../openapi-facade/adapters/registry.cjs');

const SPEC_MARKER = `libs/**/generated/*/${SPEC_FILE}`;
const PARTS = ['types', 'api', 'core'];

export interface ClientOptions {
  adapter?: string;
  /** Quelle für update-spec; generate liest immer die committete openapi.yaml */
  url?: string;
  options?: Record<string, unknown>;
}

export interface OpenApiClientsPluginOptions {
  defaultAdapter?: string;
  /** Schlüssel = Client-Pfad unter libs/, z.B. 'generated/pet-client' */
  clients?: Record<string, ClientOptions>;
}

function generateTarget(clientRoot: string, definition: Record<string, unknown>, adapter: string): TargetConfiguration {
  const registration = adapterRegistry[adapter];
  if (!registration) throw new Error(`${clientRoot}: unbekannter Adapter '${adapter}' (${Object.keys(adapterRegistry).join(', ')})`);
  return {
    executor: './tools/openapi-facade:generate',
    cache: true,
    inputs: [
      `{projectRoot}/${SPEC_FILE}`,
      // welche Teil-Libs committet sind (core optional); Workspace-Glob, weil die Teile eigene Projekte sind
      `{workspaceRoot}/${clientRoot}/*/src/index.ts`,
      '{workspaceRoot}/tools/openapi-facade/**/*',
      ...registration.inputs,
      { externalDependencies: registration.packages },
      ...registration.runtime.map((runtime) => ({ runtime })),
    ],
    outputs: PARTS.map((part) => `{projectRoot}/${part}/src/generated`),
    options: definition,
  };
}

export const createNodesV2: CreateNodesV2<OpenApiClientsPluginOptions> = [
  SPEC_MARKER,
  (specFiles, options = {}) => {
    const clients = options.clients ?? {};
    const found = specFiles.map((specFile) => dirname(specFile).slice('libs/'.length));
    const orphaned = Object.keys(clients).filter((clientPath) => !found.includes(clientPath));
    if (orphaned.length) throw new Error(`nx.json blueprint-openapi-clients: keine libs/<pfad>/${SPEC_FILE} für ${orphaned.join(', ')}`);

    return specFiles.map((specFile) => {
      const clientRoot = dirname(specFile);
      const location = parseClientPath(clientRoot.slice('libs/'.length));
      if (!location) throw new Error(`${specFile}: kein generated-Pfad`);
      const config = clients[location.clientPath] ?? {};
      const adapter = config.adapter ?? options.defaultAdapter ?? 'openapi-tools';
      const definition = {
        name: location.name,
        placement: location.placement,
        spec: { file: specFile, ...(config.url ? { url: config.url } : {}) },
        generator: { adapter, options: config.options ?? {} },
      };
      const targets: Record<string, TargetConfiguration> = { generate: generateTarget(clientRoot, definition, adapter) };
      if (config.url) {
        targets['update-spec'] = { executor: './tools/openapi-facade:update-spec', cache: false, options: definition };
      }
      const name = projectNameFor(location.clientPath);
      return [
        specFile,
        {
          projects: {
            [clientRoot]: {
              name,
              root: clientRoot,
              projectType: 'library',
              tags: [`scope:${location.scope}`, 'generated'],
              targets,
            },
          },
        },
      ] as const;
    });
  },
];
