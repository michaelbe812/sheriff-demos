/**
 * Generated testing lib of a client: libs/[<domain>/]generated/<client>/testing/src/generated/**
 * (gitignored), built from the committed spec only — independent of the code generator adapter.
 *
 *   schema.ts     openapi-typescript: `paths`, `components`, `operations`
 *   mocks.ts      orval (msw mocks only, faker): get<Op>MockHandler(), get<Op>ResponseMock() per operation
 *   model/**      orval: the schema types the mocks use
 *   http.ts       openapi-msw: `<client>Http` = createOpenApiHttp<paths>({ baseUrl: servers[0].url })
 *   handlers.ts   `<client>Handlers`: one generated default handler per operation (spec examples + faker)
 *   index.ts      barrel
 *
 * Deterministic output; faker values are seeded per test by the `worker` fixture of shared/testing.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { clientRoot, GENERATED_DIR, generatedHeader } from '../facade/facade.mjs';

/** `pet-client` → `petClient` */
export const camelCase = (name) => name.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());

/** @param {Pick<import('../facade/contract').ClientDefinition, 'name' | 'placement' | 'spec'>} client */
export async function generateTestingLib(client, workspaceRoot) {
  const specFile = join(workspaceRoot, client.spec.file);
  if (!existsSync(specFile)) throw new Error(`${client.spec.file} missing`);
  const libRoot = join(workspaceRoot, clientRoot(client), 'testing');
  if (!existsSync(join(libRoot, 'src/index.ts'))) {
    throw new Error(`${clientRoot(client)}/testing/src/index.ts missing (export * from './${GENERATED_DIR}';)`);
  }
  const document = YAML.parse(readFileSync(specFile, 'utf-8'));
  const baseUrl = document.servers?.[0]?.url ?? '';
  const name = camelCase(client.name);
  const header = generatedHeader('testing', client.spec.file);
  const rawDir = join(workspaceRoot, 'tmp/openapi', clientRoot(client).slice('libs/'.length), 'testing-raw');
  const targetDir = join(libRoot, 'src', GENERATED_DIR);
  rmSync(rawDir, { recursive: true, force: true });
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  // openapi-typescript: path/operation/schema types for openapi-msw
  const { default: openapiTS, astToString } = await import('openapi-typescript');
  const schema = astToString(await openapiTS(pathToFileURL(specFile)));

  // orval: msw mocks only. It needs a client target; the client file (fetch) is dropped.
  const { generate } = await import('orval');
  await generate(
    {
      input: { target: specFile },
      output: {
        mode: 'split',
        target: join(rawDir, 'client.ts'),
        schemas: join(rawDir, 'model'),
        client: 'fetch',
        mock: { generators: [{ type: 'msw', useExamples: true, delay: false }] },
      },
    },
    workspaceRoot,
  );
  // a spec without operations: orval writes no mock file at all
  const mocksFile = join(rawDir, 'client.msw.ts');
  const mocks = existsSync(mocksFile) ? readFileSync(mocksFile, 'utf-8') : '';
  // orval's "all handlers" function is named after the spec title: get<Title>Mock = () => [...]
  const aggregate = /export const (get\w+Mock) = \(\) => \[/.exec(mocks)?.[1];
  if (!aggregate) throw new Error(`${client.spec.file}: orval produced no msw handlers (no operations?)`);

  const files = {
    'schema.ts': schema,
    'mocks.ts': mocks,
    'http.ts': [
      "import { createOpenApiHttp } from 'openapi-msw';",
      "import type { paths } from './schema';",
      '',
      `/** Base URL of the spec (servers[0].url) — the generated client calls it. */`,
      `export const ${name}BaseUrl = ${JSON.stringify(baseUrl)};`,
      '',
      '/** Typed MSW `http`: only paths/methods/status codes of the spec, typed params, query, bodies. */',
      `export const ${name}Http = createOpenApiHttp<paths>({ baseUrl: ${name}BaseUrl });`,
      '',
    ].join('\n'),
    'handlers.ts': [
      "import type { HttpHandler } from 'msw';",
      `import { ${aggregate} } from './mocks';`,
      '',
      '/** Default handlers: every operation of the spec answers 200 with its examples, faker fills the rest. */',
      `export const ${name}Handlers: HttpHandler[] = ${aggregate}();`,
      '',
    ].join('\n'),
    'index.ts': [
      "export type { components, operations, paths } from './schema';",
      "export * from './model';",
      "export * from './mocks';",
      "export * from './http';",
      "export * from './handlers';",
      '',
    ].join('\n'),
  };
  for (const [file, content] of Object.entries(files)) writeFileSync(join(targetDir, file), header + content);
  cpSync(join(rawDir, 'model'), join(targetDir, 'model'), { recursive: true });
  for (const file of listFiles(join(targetDir, 'model'))) {
    writeFileSync(file, header + readFileSync(file, 'utf-8'));
  }
  return { baseUrl, files: Object.keys(files).length + listFiles(join(targetDir, 'model')).length };
}

/** .ts files below dir, absolute, sorted. */
function listFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .map((file) => join(dir, String(file)))
    .filter((file) => file.endsWith('.ts') && statSync(file).isFile())
    .sort();
}
