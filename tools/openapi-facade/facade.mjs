/**
 * OpenAPI-Facade: generator-unabhängiger Kern.
 *
 *   spec.file (committet) ──adapter.generate──▶ tmp/openapi/<pfad>/raw ──adapter.classify──▶ models/apis/core
 *     ──splitIntoParts──▶ <client>/{types,api,core}/src/generated/** (gitignored) + generated/index.ts
 *
 * Die Facade besitzt Ablage, Aufteilung, Import-Umschreibung und den Lint-Header. Der Adapter
 * nur Rohausgabe + Klassifizierung. Vertrag: contract.d.ts, docs/openapi-facade-spike.md.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { listTsFiles } from './adapters/files.mjs';
import { buildBarrel } from './barrel.mjs';
import { splitIntoParts } from './split.mjs';

const require = createRequire(import.meta.url);
const registry = require('./adapters/registry.cjs');

export const PARTS = ['types', 'api', 'core'];
/** gitignored Unterordner jeder Teil-Lib; die committete src/index.ts re-exportiert ihn */
export const GENERATED_DIR = 'generated';

/** @param {import('./contract').ClientDefinition} client */
export const clientRoot = (client) =>
  client.placement === 'shared' ? `libs/generated/${client.name}` : `libs/${client.placement.domain}/generated/${client.name}`;
export const partRoot = (client, part) => `${clientRoot(client)}/${part}`;
export const partAlias = (client, part) => `@blueprint/${partRoot(client, part).slice('libs/'.length)}`;

/**
 * Lint auf generiertem Code: alles aus, nur die Boundary-Regeln an. Damit greifen
 * Tags (types → api verboten) und Deep-Import-Verbot trotzdem.
 */
const header = (client) =>
  [
    '/* eslint-disable */',
    '/* eslint-enable @nx/enforce-module-boundaries, no-restricted-imports */',
    `// Generiert von tools/openapi-facade (Adapter ${client.generator.adapter}) aus ${client.spec.file}. Nicht editieren, nicht committen.`,
    '',
  ].join('\n');

export async function loadAdapter(id) {
  const registration = registry[id];
  if (!registration) throw new Error(`Unbekannter Adapter '${id}'. Bekannt: ${Object.keys(registry).join(', ')}`);
  const module = await import(pathToFileURL(join(import.meta.dirname, 'adapters', registration.module)).href);
  return { adapter: module.default, defaults: module.defaults ?? {} };
}

/** @param {import('./contract').ClientDefinition} client */
export async function generateClient(client, workspaceRoot) {
  const specFile = join(workspaceRoot, client.spec.file);
  if (!existsSync(specFile)) throw new Error(`${client.spec.file} fehlt (spec.url gesetzt? → update-spec)`);
  const { adapter, defaults } = await loadAdapter(client.generator.adapter);
  const outDir = join(workspaceRoot, 'tmp/openapi', clientRoot(client).slice('libs/'.length), 'raw');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  /** @type {import('./contract').GenerateContext} */
  const context = { specFile, outDir, options: { ...defaults, ...client.generator.options }, workspaceRoot, client };
  await adapter.generate(context);
  const classification = await adapter.classify(context);

  const aliases = Object.fromEntries(PARTS.map((part) => [part, partAlias(client, part)]));
  const parts = splitIntoParts({ rawDir: outDir, classification, aliases, allFiles: listTsFiles(outDir) });

  const written = {};
  for (const part of PARTS) {
    const { files, entries } = parts[part];
    const libRoot = join(workspaceRoot, partRoot(client, part));
    const hasLib = existsSync(join(libRoot, 'src/index.ts'));
    if (!hasLib && files.length) {
      throw new Error(
        `${partRoot(client, part)}/src/index.ts fehlt, Adapter liefert ${files.length} Dateien dafür. ` +
          `Committen: echo "export * from './${GENERATED_DIR}';" > ${partRoot(client, part)}/src/index.ts`,
      );
    }
    if (!hasLib) continue;
    const targetDir = join(libRoot, 'src', GENERATED_DIR);
    rmSync(targetDir, { recursive: true, force: true });
    for (const { path, content } of files) {
      const target = join(targetDir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, header(client) + content);
    }
    const barrel = buildBarrel(outDir, entries);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'index.ts'), `${header(client)}${barrel}\n`);
    written[part] = files.length;
  }
  return written;
}

/**
 * Spec von der URL laden (JSON oder YAML), normalisiert als YAML in spec.file schreiben.
 * Die Datei ist danach die einzige Quelle für generate (Cache-Input); generiert wird nie direkt von der URL.
 */
export async function updateSpec(client, workspaceRoot, projectName) {
  if (!client.spec.url) throw new Error(`${client.name}: keine spec.url (nx.json → plugins → blueprint-openapi-clients → clients)`);
  const response = await fetch(client.spec.url);
  if (!response.ok) throw new Error(`GET ${client.spec.url}: ${response.status}`);
  const document = YAML.parse(await response.text());
  const normalized = [
    `# Quelle: ${client.spec.url}`,
    `# Aktualisieren: nx run ${projectName}:update-spec (überschreibt die Datei, normalisiert). Committet, Quelle für generate.`,
    YAML.stringify(document, { lineWidth: 0, aliasDuplicateObjects: false }),
  ].join('\n');
  const file = join(workspaceRoot, client.spec.file);
  const before = existsSync(file) ? readFileSync(file, 'utf-8') : undefined;
  if (before !== normalized) writeFileSync(file, normalized);
  return { changed: before !== normalized };
}
