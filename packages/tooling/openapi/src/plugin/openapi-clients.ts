/**
 * Crystal plugin for the generated OpenAPI clients (docs/nx-umsetzung.md → "OpenAPI-Clients"),
 * registered in nx.json after @blueprint/tooling-workspace (which infers the libs).
 *
 *   openapi-clients.json (workspace root)    one entry per client, key = client path below libs/:
 *     { "defaultAdapter": "openapi-tools",
 *       "clients": { "generated/pet-client": { "url": "https://…", "adapter"?: "hey-api", "options"?: {…} } } }
 *   libs/<client path>/openapi.yaml|json     committed spec — the only source for `generate`
 *
 *   client project  <path with ->  (generated-pet-client), tags scope:<shared|domain> + generated, no code, no alias
 *     generate      @blueprint/tooling-openapi:generate, cached, outputs <part>/src/generated (types, api, core)
 *     update-spec   @blueprint/tooling-openapi:update-spec, only with `url`, not cached
 *   The entry is a `json` input (fields) of `generate`, not its options: changing an entry invalidates this
 *   client only (and, through the generated code, its dependents). Its target options hold only `client`.
 *   A separate file instead of nx.json on purpose: any nx.json change invalidates the whole cache.
 *
 * The client libs (types/api/core/testing) are ordinary libs (committed src/index.ts): the workspace
 * plugin infers them (name, tags, targets). This plugin adds to the same roots (Nx merges both results):
 * the edges part → client (→ sibling parts), the `generate` of the testing lib, and a graph error for a
 * part without entry. No runtime imports besides node:fs/path and the conventions (no @nx/devkit).
 */
import type { CreateNodesResult, CreateNodesV2, ProjectConfiguration, TargetConfiguration } from '@nx/devkit';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  CLIENT_CODE_PARTS,
  CLIENT_SPEC_FILES,
  CLIENTS_CONFIG_FILE,
  type ClientPath,
  GENERATED_FOLDER,
  GENERATED_TAG,
  LIBS_DIR,
  parseClientPath,
  parseLibPath,
  projectNameFor,
  scopesOfNxJson,
  TESTING_LAYER,
} from '@blueprint/tooling-conventions';

export interface ClientEntry {
  /** adapter id (adapters/registry.json), default: `defaultAdapter` */
  adapter?: string;
  /** source for update-spec; generate always reads the committed spec file */
  url?: string;
  /** adapter options, merged over the adapter's defaults */
  options?: Record<string, unknown>;
}

export interface ClientsConfig {
  defaultAdapter?: string;
  /** key = client path below libs/, e.g. `generated/pet-client`, `booking/generated/booking-client` */
  clients?: Record<string, ClientEntry>;
}

interface AdapterRegistration {
  packages: string[];
  inputs: string[];
  runtime: string[];
}

/** Executors of this package (executors.json). */
export const OPENAPI_EXECUTORS = {
  generate: '@blueprint/tooling-openapi:generate',
  generateTesting: '@blueprint/tooling-openapi:generate-testing',
  updateSpec: '@blueprint/tooling-openapi:update-spec',
};
/** npm packages of the testing pipeline (cache inputs of the testing lib's generate) */
const TESTING_PACKAGES = ['openapi-typescript', 'orval', 'yaml'];
export const DEFAULT_ADAPTER = 'openapi-tools';
const PACKAGE_DIR = 'packages/tooling/openapi/src';
const FACADE_DIR = `${PACKAGE_DIR}/facade`;
const TESTING_DIR = `${PACKAGE_DIR}/testing`;
const EXECUTORS_DIR = `${PACKAGE_DIR}/executors`;
const REGISTRY_FILE = join(__dirname, '../facade/adapters/registry.json');

/** Adapter registry (cache inputs per adapter), read once per plugin worker. */
let registry: Record<string, AdapterRegistration> | undefined;
export function adapterRegistry(): Record<string, AdapterRegistration> {
  registry ??= Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8')) as Record<string, AdapterRegistration>).filter(
      ([id]) => !id.startsWith('$'),
    ),
  );
  return registry;
}

/** openapi-clients.json, `{}` if the workspace has none. */
export function readClientsConfig(workspaceRoot: string): ClientsConfig {
  const file = join(workspaceRoot, CLIENTS_CONFIG_FILE);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as ClientsConfig;
  } catch (error) {
    throw new Error(`${CLIENTS_CONFIG_FILE}: invalid JSON (${(error as Error).message})`);
  }
}

/** The committed spec of a client folder: exactly one of openapi.yaml / openapi.json. */
export function findSpecFile(workspaceRoot: string, clientPath: string): string {
  const found = CLIENT_SPEC_FILES.filter((file) => existsSync(join(workspaceRoot, LIBS_DIR, clientPath, file)));
  if (found.length !== 1) {
    throw new Error(
      `${CLIENTS_CONFIG_FILE} → "${clientPath}": ${LIBS_DIR}/${clientPath} needs exactly one spec file ` +
        `(${CLIENT_SPEC_FILES.join(' | ')}), found ${found.length ? found.join(', ') : 'none'}. ` +
        `New client: nx g @blueprint/tooling-openapi:client <name> --spec=<file|url>`,
    );
  }
  return `${LIBS_DIR}/${clientPath}/${found[0]}`;
}

/** The part libs depend on: their client (generate, affected) and the parts below them (build order). */
export function clientPartEdges(workspaceRoot: string, client: { path: string; part: string }): string[] {
  const below: Record<string, string[]> = { types: [], core: ['types'], api: ['types', 'core'], testing: [] };
  const siblings = (below[client.part] ?? [])
    .filter((part) => existsSync(join(workspaceRoot, LIBS_DIR, client.path, part, 'src/index.ts')))
    .map((part) => projectNameFor(`${client.path}/${part}`));
  return [projectNameFor(client.path), ...siblings];
}

function generateTarget(clientPath: string, specFile: string, adapter: string): TargetConfiguration {
  const registration = adapterRegistry()[adapter];
  if (!registration) {
    throw new Error(
      `${CLIENTS_CONFIG_FILE} → "${clientPath}": unknown adapter "${adapter}" (known: ${Object.keys(adapterRegistry()).join(', ')})`,
    );
  }
  return {
    executor: OPENAPI_EXECUTORS.generate,
    cache: true,
    inputs: [
      `{workspaceRoot}/${specFile}`,
      // this client's entry only (+ the default adapter it may fall back to) — not the whole file
      { json: `{workspaceRoot}/${CLIENTS_CONFIG_FILE}`, fields: ['defaultAdapter', `clients.${clientPath}`] },
      // which parts are committed (core is optional) — the parts are projects of their own
      ...CLIENT_CODE_PARTS.map((part) => `{workspaceRoot}/${LIBS_DIR}/${clientPath}/${part}/src/index.ts`),
      // the facade only — the testing pipeline has its own target (generate of <client>/testing)
      `{workspaceRoot}/${FACADE_DIR}/**/*`,
      `{workspaceRoot}/${EXECUTORS_DIR}/**/*`,
      ...registration.inputs,
      { externalDependencies: [...registration.packages, 'typescript', 'yaml'] },
      ...registration.runtime.map((runtime) => ({ runtime })),
    ],
    outputs: CLIENT_CODE_PARTS.map((part) => `{projectRoot}/${part}/src/generated`),
    options: { client: clientPath },
    metadata: {
      description: `Generates the client (${adapter}) into ${CLIENT_CODE_PARTS.join('/')}/src/generated from ${specFile}`,
    },
  };
}

/**
 * `generate` of a client's testing lib (<client>/testing): spec → openapi-typescript + orval mocks +
 * openapi-msw. Its options hold only name/placement/spec — an adapter switch keeps its cache.
 */
export function generateTestingTarget(workspaceRoot: string, clientPath: string): TargetConfiguration {
  const specFile = findSpecFile(workspaceRoot, clientPath);
  return {
    executor: OPENAPI_EXECUTORS.generateTesting,
    cache: true,
    inputs: [
      `{workspaceRoot}/${specFile}`,
      `{workspaceRoot}/${FACADE_DIR}/facade.mjs`,
      `{workspaceRoot}/${TESTING_DIR}/**/*`,
      `{workspaceRoot}/${EXECUTORS_DIR}/generate-testing.js`,
      { externalDependencies: TESTING_PACKAGES },
    ],
    outputs: ['{projectRoot}/src/generated'],
    options: { client: clientPath },
    metadata: { description: `Generates MSW handlers, faker factories and the typed <client>Http from ${specFile}` },
  };
}

/** Client projects from openapi-clients.json (one per entry). Throws on an inconsistent entry. */
export function createClientProjects(
  workspaceRoot: string,
  config: ClientsConfig,
  scopes: string[] | undefined,
): Record<string, ProjectConfiguration> {
  const projects: Record<string, ProjectConfiguration> = {};
  for (const [clientPath, entry] of Object.entries(config.clients ?? {})) {
    const client: ClientPath | undefined = parseClientPath(clientPath);
    if (!client) {
      throw new Error(
        `${CLIENTS_CONFIG_FILE} → "${clientPath}": not a client path (generated/<client> or <domain>/generated/<client>)`,
      );
    }
    if (scopes && !scopes.includes(client.scope)) {
      throw new Error(
        `${CLIENTS_CONFIG_FILE} → "${clientPath}": scope "${client.scope}" is not in the scope list (nx.json)`,
      );
    }
    const specFile = findSpecFile(workspaceRoot, clientPath);
    const adapter = entry.adapter ?? config.defaultAdapter ?? DEFAULT_ADAPTER;
    const targets: Record<string, TargetConfiguration> = {
      generate: generateTarget(clientPath, specFile, adapter),
      // always there (fails without url): adding a url must not change the project config (see above)
      'update-spec': {
        executor: OPENAPI_EXECUTORS.updateSpec,
        cache: false,
        // reads the url from the file at run time; not cached, so this input only feeds `nx affected`:
        // an edited openapi-clients.json affects every client (the cache of generate stays per entry)
        inputs: [`{workspaceRoot}/${CLIENTS_CONFIG_FILE}`],
        options: { client: clientPath },
        metadata: { description: `Downloads the entry's url into ${specFile} (normalized)` },
      },
    };
    const root = `${LIBS_DIR}/${clientPath}`;
    projects[root] = {
      name: projectNameFor(clientPath),
      root,
      projectType: 'library',
      tags: [`scope:${client.scope}`, GENERATED_TAG],
      targets,
      metadata: { description: `OpenAPI client ${client.name} (${CLIENTS_CONFIG_FILE}), spec ${specFile}` },
    };
  }
  return projects;
}

/**
 * A client lib (libs/[<domain>/]generated/<client>/<part>): its entry must exist; edges part → client
 * (`^generate`, affected) → sibling parts (build order); the testing part generates its own code before
 * lint/typecheck (`'...'` keeps the workspace plugin's `^generate`). Name, tags and targets come from the
 * workspace plugin — this is a partial configuration for the same root.
 */
function clientPartNode(indexFile: string, workspaceRoot: string, clients: ClientsConfig): CreateNodesResult {
  const projectRoot = dirname(dirname(indexFile));
  const client = parseLibPath(projectRoot.slice(`${LIBS_DIR}/`.length))?.client;
  // not a client part (the workspace plugin reports a malformed path itself)
  if (!client) return {};
  if (!clients.clients?.[client.path]) {
    throw new Error(
      `${projectRoot}: part of client "${client.path}", but ${CLIENTS_CONFIG_FILE} has no entry for it ` +
        `(nx g @blueprint/tooling-openapi:client ${client.name} …, or remove ${LIBS_DIR}/${client.path})`,
    );
  }
  const project: Omit<ProjectConfiguration, 'name'> = {
    root: projectRoot,
    // gitignored generated code is invisible to the graph: part → client (generate, affected), api → core → types
    implicitDependencies: clientPartEdges(workspaceRoot, client),
  };
  if (client.part === TESTING_LAYER) {
    project.targets = {
      generate: generateTestingTarget(workspaceRoot, client.path),
      lint: { dependsOn: ['generate', '...'] },
      typecheck: { dependsOn: ['generate', '...'] },
    };
  }
  return { projects: { [projectRoot]: project } };
}

/** openapi-clients.json (client projects) + the committed index.ts of every client part. */
const MARKER = `{${CLIENTS_CONFIG_FILE},${LIBS_DIR}/**/${GENERATED_FOLDER}/*/*/src/index.ts}`;

export const createNodesV2: CreateNodesV2 = [
  MARKER,
  (files, _options, context) => {
    const clients = readClientsConfig(context.workspaceRoot);
    // the scope list belongs to the workspace plugin's entry in nx.json
    const scopes = scopesOfNxJson(context.nxJsonConfiguration);
    return files.map((file) =>
      file === CLIENTS_CONFIG_FILE
        ? ([file, { projects: createClientProjects(context.workspaceRoot, clients, scopes) }] as const)
        : ([file, clientPartNode(file, context.workspaceRoot, clients)] as const),
    );
  },
];
