/**
 * Adapter `openapi-tools` (default): OpenAPI Generator `typescript-angular` via
 * @openapitools/openapi-generator-cli (jar, local JRE 11+, no Docker). Jar version and storage:
 * openapitools.json (workspace root). Output:
 *   model/*.ts            → types
 *   api/*.ts              → api     (services, providedIn root, HttpClient)
 *   *.ts in the root      → core    (Configuration, BASE_PATH, encoder, provideApi, BaseService …)
 *   index.ts, api.module.ts, README, git_push.sh, .openapi-generator/ → dropped
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { listTsFiles } from './files.mjs';

// fixed: the classification depends on these folders
const MODEL_PACKAGE = 'model';
const API_PACKAGE = 'api';
// api.module.ts: NgModule leftover, standalone has provideApi(); index.ts: barrel, the facade writes its own
const DROPPED = new Set(['index.ts', 'api.module.ts']);

/** Overridable per client: openapi-clients.json → clients → <path> → options. */
export const defaults = {
  ngVersion: '22.0.0',
  providedIn: 'root',
  fileNaming: 'kebab-case',
  // stringEnums stays off (default): `const X = {...} as const` + `type X = (typeof X)[keyof typeof X]`
  // = string union instead of a TS enum. Domain unions and test fixtures fit structurally.
  supportsES6: true,
  useSingleRequestParameter: true,
  // do NOT pass withInterfaces=false: 7.25 reads the string "false" as true in api.ts
  // (export * from './x.serviceInterface' without the file). Off by default anyway.
};

/** @type {import('../contract').GeneratorAdapter} */
const openapiToolsAdapter = {
  id: 'openapi-tools',
  async generate({ specFile, outDir, options, workspaceRoot }) {
    const properties = { ...options, modelPackage: MODEL_PACKAGE, apiPackage: API_PACKAGE };
    const additional = Object.entries(properties)
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    const cli = join(workspaceRoot, 'node_modules/.bin/openapi-generator-cli');
    const args = ['generate', '-g', 'typescript-angular', '-i', specFile, '-o', outDir];
    args.push('--openapitools', join(workspaceRoot, 'openapitools.json'), `--additional-properties=${additional}`);
    try {
      // the cli resolves generator-cli.storageDir against $PWD (not cwd): pin it to the workspace root.
      // First run downloads the jar (network); parallel downloads are safe (tmp file + move).
      execFileSync(cli, args, { cwd: workspaceRoot, stdio: 'pipe', env: { ...process.env, PWD: workspaceRoot } });
    } catch (error) {
      throw new Error(
        `openapi-generator-cli failed (Java 11+ in PATH? network for the first jar download?):\n${error.stdout ?? ''}${error.stderr ?? ''}`,
      );
    }
  },
  async classify({ outDir }) {
    return classifyOpenApiTools(outDir);
  },
};
export default openapiToolsAdapter;

/** Also used by the nx-plugin-openapi adapter (same output). */
export function classifyOpenApiTools(outDir) {
  const files = listTsFiles(outDir);
  return {
    models: files.filter((file) => file.startsWith(`${MODEL_PACKAGE}/`)),
    apis: files.filter((file) => file.startsWith(`${API_PACKAGE}/`)),
    core: files.filter((file) => !file.includes('/') && !DROPPED.has(file)),
    // models.ts / api.ts are the generator's barrels (api.ts additionally APIS = [...])
    entries: {
      types: [`${MODEL_PACKAGE}/models.ts`].filter((file) => files.includes(file)),
      api: [`${API_PACKAGE}/api.ts`].filter((file) => files.includes(file)),
    },
  };
}
