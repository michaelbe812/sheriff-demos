/**
 * openapi-clients.json on the Nx Tree: read/write entries, keep them in step with moved/removed libs
 * (used by the client generator and by move/rename/remove of @blueprint/tooling-workspace).
 */
import type { Tree } from '@nx/devkit';
import {
  CLIENTS_CONFIG_FILE,
  GENERATED_TAG,
  LIBS_DIR,
  parseClientPath,
  projectNameFor,
} from '@blueprint/tooling-conventions';
import type { ClientEntry, ClientsConfig } from './project-config';
import {
  forEachSourceFile,
  type Moved,
  offsetFromRoot,
  readJsonFile,
  replacePaths,
  writeJsonFile,
} from '@blueprint/tooling-conventions/tree';

export type { ClientEntry, ClientsConfig } from './project-config';

/** openapi-clients.json in the tree (defaults if missing). */
export function readClientsJson(tree: Tree): ClientsConfig & { $schema?: string } {
  if (!tree.exists(CLIENTS_CONFIG_FILE)) {
    return {
      $schema: './packages/tooling/openapi/openapi-clients.schema.json',
      defaultAdapter: 'openapi-tools',
      clients: {},
    };
  }
  return JSON.parse(tree.read(CLIENTS_CONFIG_FILE, 'utf-8') ?? '{}');
}

/** 2 spaces + newline (Prettier-stable, formatFiles keeps it), key order kept. */
export function writeClientsJson(tree: Tree, config: ClientsConfig): void {
  tree.write(CLIENTS_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
}

export function addClientEntry(tree: Tree, clientPath: string, entry: ClientEntry): void {
  const config = readClientsJson(tree);
  writeClientsJson(tree, { ...config, clients: { ...config.clients, [clientPath]: entry } });
}

/**
 * Keeps openapi-clients.json in step with a moved/removed lib path: every client at or below `from`
 * is renamed to `to` (move) or dropped (`to` undefined, remove). A path inside a client (one part) leaves
 * the entry alone. Returns the affected [from, to] client paths.
 */
export function updateClientEntries(tree: Tree, from: string, to?: string): [string, string | undefined][] {
  if (!tree.exists(CLIENTS_CONFIG_FILE)) return [];
  const config = readClientsJson(tree);
  const changed: [string, string | undefined][] = [];
  const clients = Object.fromEntries(
    Object.entries(config.clients ?? {}).flatMap(([clientPath, entry]) => {
      if (clientPath !== from && !clientPath.startsWith(`${from}/`)) return [[clientPath, entry]];
      const target = to === undefined ? undefined : `${to}${clientPath.slice(from.length)}`;
      changed.push([clientPath, target]);
      return target === undefined ? [] : [[target, entry]];
    }),
  );
  if (changed.length) writeClientsJson(tree, { ...config, clients });
  return changed;
}

/**
 * The client project.json (libs/<client>/project.json, not a lib) after the client moved from `from` to `to`:
 * name, $schema offset, scope tag, and every path in its targets (spec input, json fields, `client` option).
 * `moved` = what the move generator moved (the client, or the slice it lives in). Returns the new project name.
 */
export function relocateClientProject(tree: Tree, from: string, to: string, moved: Moved = { from, to }): string {
  const file = `${LIBS_DIR}/${to}/project.json`;
  const client = parseClientPath(to);
  const name = projectNameFor(to);
  if (!tree.exists(file) || !client) return name;
  const project = replacePaths(readJsonFile(tree, file), moved.from, moved.to) as Record<string, unknown>;
  writeJsonFile(tree, file, {
    ...project,
    name,
    $schema: `${offsetFromRoot(`${LIBS_DIR}/${to}`)}node_modules/nx/schemas/project-schema.json`,
    tags: [`scope:${client.scope}`, GENERATED_TAG],
  });
  return name;
}

/** `pet-client` → `petClient` (prefix of the generated testing exports: petClientHttp, petClientHandlers …). */
export const clientExportPrefix = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_, char: string) => char.toUpperCase());

/**
 * A renamed client renames its generated testing exports (`<client>Http`, `<client>Handlers`,
 * `<client>BaseUrl`): rewrite their usages in apps/ and libs/. Returns the changed files.
 */
export function renameClientExports(tree: Tree, fromClientPath: string, toClientPath: string): string[] {
  const from = parseClientPath(fromClientPath);
  const to = parseClientPath(toClientPath);
  if (!from || !to || from.name === to.name) return [];
  const pattern = new RegExp(`\\b${clientExportPrefix(from.name)}(Http|Handlers|BaseUrl)\\b`, 'g');
  const changed: string[] = [];
  forEachSourceFile(tree, (file, content) => {
    const updated = content.replace(pattern, `${clientExportPrefix(to.name)}$1`);
    if (updated !== content) {
      tree.write(file, updated);
      changed.push(file);
    }
  });
  return changed;
}
