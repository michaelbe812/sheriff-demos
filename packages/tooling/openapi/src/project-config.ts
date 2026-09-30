/**
 * Explicit Nx config of the generated OpenAPI clients (docs/nx-umsetzung.md → "OpenAPI-Clients"):
 * what the client generator writes into the project.json files, and what move/rename keep in step.
 *
 *   openapi-clients.json (workspace root)    one entry per client, key = client path below libs/:
 *     { "defaultAdapter": "openapi-tools",
 *       "clients": { "generated/pet-client": { "url": "https://…", "adapter"?: "hey-api", "options"?: {…} } } }
 *   libs/<client path>/openapi.yaml|json     committed spec — the only source for `generate`
 *   libs/<client path>/project.json          client project (generated-pet-client): tags scope:<shared|domain> +
 *                                            generated, no code, no alias
 *     generate      @blueprint/tooling-openapi:generate, cached, outputs <part>/src/generated (types, api, core)
 *     update-spec   @blueprint/tooling-openapi:update-spec, fails without `url`, not cached
 *   libs/<client path>/<part>/project.json   ordinary lib config (tooling-conventions) + implicitDependencies
 *                                            part → client (→ sibling parts); the testing part has its own generate
 *
 * The entry stays in openapi-clients.json and is a `json` input (fields) of `generate`, never its options:
 * Nx hashes the ProjectConfiguration of every dependency into `^default`/`^production`, target options there
 * would invalidate every dependent on any entry change. The options hold only `client`.
 * Adapter-dependent inputs (registry.json) are written for the entry's adapter; verify checks they match.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIENT_CODE_PARTS,
  CLIENT_SPEC_FILES,
  CLIENTS_CONFIG_FILE,
  GENERATED_TAG,
  LIBS_DIR,
  parseClientPath,
  projectNameFor,
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

/** A target as written into project.json. */
export type TargetJson = Record<string, unknown>;

/** Checks for files relative to the workspace root (fs or an Nx Tree). */
export type Exists = (path: string) => boolean;

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
const REGISTRY_FILE = join(__dirname, 'facade/adapters/registry.json');

/** Adapter registry (cache inputs per adapter), read once. */
let registry: Record<string, AdapterRegistration> | undefined;
export function adapterRegistry(): Record<string, AdapterRegistration> {
  registry ??= Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8')) as Record<string, AdapterRegistration>).filter(
      ([id]) => !id.startsWith('$'),
    ),
  );
  return registry;
}

/** Adapter of an entry: its own, else the file's default, else openapi-tools. Throws for an unknown one. */
export function adapterOf(clientPath: string, config: ClientsConfig): string {
  const adapter = config.clients?.[clientPath]?.adapter ?? config.defaultAdapter ?? DEFAULT_ADAPTER;
  if (!adapterRegistry()[adapter]) {
    throw new Error(
      `${CLIENTS_CONFIG_FILE} → "${clientPath}": unknown adapter "${adapter}" (known: ${Object.keys(adapterRegistry()).join(', ')})`,
    );
  }
  return adapter;
}

/** The committed spec of a client folder: exactly one of openapi.yaml / openapi.json. */
export function findSpecFile(exists: Exists, clientPath: string): string {
  const found = CLIENT_SPEC_FILES.filter((file) => exists(`${LIBS_DIR}/${clientPath}/${file}`));
  if (found.length !== 1) {
    throw new Error(
      `${CLIENTS_CONFIG_FILE} → "${clientPath}": ${LIBS_DIR}/${clientPath} needs exactly one spec file ` +
        `(${CLIENT_SPEC_FILES.join(' | ')}), found ${found.length ? found.join(', ') : 'none'}. ` +
        `New client: nx g @blueprint/tooling-openapi:client <name> --spec=<file|url>`,
    );
  }
  return `${LIBS_DIR}/${clientPath}/${found[0]}`;
}

/**
 * implicitDependencies of a part lib: its client (`^generate`, affected — the generated code is gitignored,
 * so Nx sees no import edges) and the parts below it (build order).
 */
export function clientPartEdges(exists: Exists, client: { path: string; part: string }): string[] {
  const below: Record<string, string[]> = { types: [], core: ['types'], api: ['types', 'core'], testing: [] };
  const siblings = (below[client.part] ?? [])
    .filter((part) => exists(`${LIBS_DIR}/${client.path}/${part}/src/index.ts`))
    .map((part) => projectNameFor(`${client.path}/${part}`));
  return [projectNameFor(client.path), ...siblings];
}

/** `generate` of the client project: the facade + the entry's adapter. */
export function generateTarget(clientPath: string, specFile: string, adapter: string): TargetJson {
  const registration = adapterRegistry()[adapter];
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
  };
}

/** `update-spec` of the client project — always there (fails without url): adding a url changes no project.json. */
export function updateSpecTarget(clientPath: string): TargetJson {
  return {
    executor: OPENAPI_EXECUTORS.updateSpec,
    cache: false,
    // reads the url from the file at run time; not cached, so this input only feeds `nx affected`:
    // an edited openapi-clients.json affects every client (the cache of generate stays per entry)
    inputs: [`{workspaceRoot}/${CLIENTS_CONFIG_FILE}`],
    options: { client: clientPath },
  };
}

/**
 * `generate` of a client's testing lib (<client>/testing): spec → openapi-typescript + orval mocks +
 * openapi-msw. Independent of the adapter — a switch keeps its cache.
 */
export function generateTestingTarget(clientPath: string, specFile: string): TargetJson {
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
  };
}

/** project.json of the client project (libs/<client path>/project.json). */
export function clientProjectJson(exists: Exists, clientPath: string, config: ClientsConfig): Record<string, unknown> {
  const client = parseClientPath(clientPath);
  if (!client) {
    throw new Error(
      `${CLIENTS_CONFIG_FILE} → "${clientPath}": not a client path (generated/<client> or <domain>/generated/<client>)`,
    );
  }
  const root = `${LIBS_DIR}/${clientPath}`;
  const specFile = findSpecFile(exists, clientPath);
  return {
    name: projectNameFor(clientPath),
    $schema: `${'../'.repeat(root.split('/').length)}node_modules/nx/schemas/project-schema.json`,
    projectType: 'library',
    tags: [`scope:${client.scope}`, GENERATED_TAG],
    targets: {
      generate: generateTarget(clientPath, specFile, adapterOf(clientPath, config)),
      'update-spec': updateSpecTarget(clientPath),
    },
  };
}

/**
 * Lib config options of a client part (for writeLibConfig of tooling-conventions): edges; the testing part
 * generates its own code before lint/typecheck. No peerDependencies: the generated code is gitignored
 * (dist identical to the former inferred setup).
 */
export function clientPartConfig(exists: Exists, clientPath: string, part: string) {
  const implicitDependencies = clientPartEdges(exists, { path: clientPath, part });
  if (part !== TESTING_LAYER) return { implicitDependencies, peerDependencies: {} };
  return {
    implicitDependencies,
    peerDependencies: {},
    targets: {
      generate: generateTestingTarget(clientPath, findSpecFile(exists, clientPath)),
      lint: { dependsOn: ['generate', '^generate'] },
      typecheck: { dependsOn: ['generate', '^generate'] },
    },
  };
}
