/**
 * Adapter `hey-api`: @hey-api/openapi-ts with the Angular client (@hey-api/client-angular, bundled)
 * and the @angular/common plugin (injectable request/resource classes). Pure Node, no Java. Output:
 *   types.gen.ts                          → types
 *   sdk.gen.ts, @angular/**               → api   (0.83: @angular/common/http/{requests,resources}.gen.ts)
 *   client.gen.ts, client/**, core/**     → core  (client runtime, provideHeyApiClient)
 *   index.ts                              → dropped
 */
import { listTsFiles } from './files.mjs';

const isApi = (file) => file === 'sdk.gen.ts' || file.startsWith('@angular/');

/** Overridable per client (openapi-clients.json → options; `plugins` replaces the whole list). */
export const defaults = {
  plugins: [
    '@hey-api/client-angular',
    '@hey-api/typescript',
    '@hey-api/sdk',
    // injectable classes per tag (<Tag>Requests: HttpRequest factories, <Tag>Resources: httpResource)
    { name: '@angular/common', httpRequests: { asClass: true }, httpResources: { asClass: true } },
  ],
};

/** @type {import('../contract').GeneratorAdapter} */
export const heyApiAdapter = {
  id: 'hey-api',
  async generate({ specFile, outDir, options }) {
    // pinned to 0.83.x: Node >= 22.10 (0.96 needs >= 22.13, 0.98 >= 22.18), peer of nx-plugin-openapi
    const { createClient } = await import('@hey-api/openapi-ts');
    await createClient({
      ...options,
      // absolute: a relative path like `specs/x.yaml` would be read as registry shorthand org/project
      input: specFile,
      output: { path: outDir, clean: true },
      logs: { level: 'silent', file: false },
    });
  },
  async classify({ outDir }) {
    return classifyHeyApi(outDir);
  },
};
export default heyApiAdapter;

/** Also used by the nx-plugin-openapi adapter (same output). */
export function classifyHeyApi(outDir) {
  const files = listTsFiles(outDir);
  return {
    models: files.filter((file) => file === 'types.gen.ts'),
    apis: files.filter(isApi),
    core: files.filter((file) => file === 'client.gen.ts' || file.startsWith('client/') || file.startsWith('core/')),
    entries: {
      api: files.filter(isApi),
      // core/*.gen.ts are internal, client/index.ts re-exports what is needed
      core: ['client.gen.ts', 'client/index.ts'],
    },
  };
}
