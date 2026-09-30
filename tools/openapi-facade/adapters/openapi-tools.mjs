/**
 * Adapter a) OpenAPI Generator `typescript-angular` über @openapitools/openapi-generator-cli (Jar, lokales JRE, kein Docker).
 * Jar-Version: openapitools.json (Workspace-Root). Ausgabe:
 *   model/*.ts            → types
 *   api/*.ts              → api     (Services, providedIn root, HttpClient)
 *   *.ts im Root          → core    (Configuration, BASE_PATH, Encoder, provideApi, BaseService …)
 *   index.ts, api.module.ts, README, git_push.sh, .openapi-generator/ → verworfen
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { listTsFiles } from './files.mjs';

// fest: die Klassifizierung hängt an diesen Ordnern
const MODEL_PACKAGE = 'model';
const API_PACKAGE = 'api';
// api.module.ts: NgModule-Altlast, standalone gibt es provideApi(); index.ts: Barrel, das schreibt die Facade selbst
const DROPPED = new Set(['index.ts', 'api.module.ts']);

/** Überschreibbar per nx.json `generator.options`. */
export const defaults = {
  ngVersion: '22.0.0',
  providedIn: 'root',
  fileNaming: 'kebab-case',
  // stringEnums bleibt aus (Default): dann `const X = {...} as const` + `type X = (typeof X)[keyof typeof X]`
  // = String-Union statt TS-enum. Domain-Unions und Test-Fixtures (openapi-typescript) passen strukturell.
  supportsES6: true,
  useSingleRequestParameter: true,
  // withInterfaces NICHT als false übergeben: 7.25 wertet den String "false" in api.ts als wahr
  // (export * from './x.serviceInterface' ohne die Datei). Default ist ohnehin aus.
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
      execFileSync(cli, args, { cwd: workspaceRoot, stdio: 'pipe' });
    } catch (error) {
      throw new Error(`openapi-generator-cli fehlgeschlagen (Java 11+ im PATH?):\n${error.stdout ?? ''}${error.stderr ?? ''}`);
    }
  },
  async classify({ outDir }) {
    return classifyOpenApiTools(outDir);
  },
};
export default openapiToolsAdapter;

/** Auch vom nx-plugin-openapi-Adapter genutzt (gleiche Ausgabe). */
export function classifyOpenApiTools(outDir) {
    const files = listTsFiles(outDir);
    return {
      models: files.filter((file) => file.startsWith(`${MODEL_PACKAGE}/`)),
      apis: files.filter((file) => file.startsWith(`${API_PACKAGE}/`)),
      core: files.filter((file) => !file.includes('/') && !DROPPED.has(file)),
      // models.ts / api.ts sind die Barrels des Generators (api.ts zusätzlich APIS = [...])
      entries: {
        types: [`${MODEL_PACKAGE}/models.ts`].filter((file) => files.includes(file)),
        api: [`${API_PACKAGE}/api.ts`].filter((file) => files.includes(file)),
      },
    };
}
