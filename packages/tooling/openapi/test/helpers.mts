/**
 * Fixture workspaces for the integration tests: a folder below <repo>/tmp/openapi-it (gitignored) with
 * `node_modules` linked to the repo's (the adapters start node_modules/.bin/openapi-generator-cli relative
 * to the workspace root, the jar lies in node_modules/.cache), a copy of openapitools.json, libs/ and
 * openapi-clients.json. Generated code resolves @angular/*, msw … through the link.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export const repoRoot = resolve(import.meta.dirname, '../../../..');
export const fixture = (name: string): string => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf-8');
export const THINGS_SPEC = fixture('things.yaml');

let counter = 0;

export function createWorkspace(name: string): string {
  const root = join(repoRoot, 'tmp/openapi-it', `${name}-${process.pid}-${counter++}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  copyFileSync(join(repoRoot, 'openapitools.json'), join(root, 'openapitools.json'));
  return root;
}

export const removeWorkspace = (root: string): void => rmSync(root, { recursive: true, force: true });

export function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf-8');

interface ClientFixture {
  spec?: string;
  specFile?: 'openapi.yaml' | 'openapi.json';
  entry?: Record<string, unknown>;
  parts?: string[];
  defaultAdapter?: string;
}

/** A client like `nx g @blueprint/tooling-openapi:client` lays it out: spec, libs with only index.ts, entry. */
export function addClient(root: string, clientPath: string, fixtureOptions: ClientFixture = {}): void {
  const {
    spec = THINGS_SPEC,
    specFile = 'openapi.yaml',
    entry = {},
    parts = ['types', 'api', 'core', 'testing'],
  } = fixtureOptions;
  write(root, `libs/${clientPath}/${specFile}`, spec);
  for (const part of parts) write(root, `libs/${clientPath}/${part}/src/index.ts`, "export * from './generated';\n");
  const configFile = join(root, 'openapi-clients.json');
  const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf-8')) : { clients: {} };
  if (fixtureOptions.defaultAdapter) config.defaultAdapter = fixtureOptions.defaultAdapter;
  config.clients[clientPath] = entry;
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
}

/** Every file below dir (relative path → sha256), for byte-identity checks. */
export function hashTree(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir, { recursive: true })
      .map(String)
      .filter((file) => statSync(join(dir, file)).isFile())
      .sort()
      .map((file) => [
        file,
        createHash('sha256')
          .update(readFileSync(join(dir, file)))
          .digest('hex'),
      ]),
  );
}

/** Relative paths of the files below dir, sorted. */
export const filesBelow = (dir: string): string[] => Object.keys(hashTree(dir));

/**
 * Typechecks the given files against the lib aliases of the fixture workspace (`@blueprint/*` →
 * libs/*\/src/index.ts, as tsconfig.base.json does) with the compiler options of a lib tsconfig.json.
 * Returns the formatted diagnostics (empty = compiles).
 */
export function typecheck(root: string, files: string[]): string[] {
  const program = ts.createProgram({
    rootNames: files.map((file) => join(root, file)),
    options: {
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
      // absolute: TS 6 deprecates baseUrl, paths resolve without it
      paths: { '@blueprint/*': [join(root, 'libs/*/src/index.ts')] },
    },
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) =>
      diagnostic.file
        ? `${relative(root, diagnostic.file.fileName)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
        : ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    );
}

/** Local HTTP server as spec source (update-spec, client generator with URL). */
export async function startSpecServer(
  respond: (path: string) => { status: number; body: string },
): Promise<{ url: (path: string) => string; close: () => Promise<void>; server: Server }> {
  const server = createServer((request, response) => {
    const { status, body } = respond(request.url ?? '/');
    response.writeHead(status, { 'content-type': 'text/plain' });
    response.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    server,
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** Minimal ExecutorContext as Nx passes it (root, project, target). */
export function executorContext(root: string, projectName: string, targetName: string) {
  return {
    root,
    cwd: root,
    isVerbose: false,
    projectName,
    targetName,
    projectsConfigurations: { version: 2, projects: {} },
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
  };
}
