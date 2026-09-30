/**
 * Adapter b) @hey-api/openapi-ts mit Angular-Client (@hey-api/client-angular, gebündelt) und
 * @angular/common-Plugin (injectable Request-/Resource-Klassen). Reines Node, kein Java. Ausgabe:
 *   types.gen.ts                          → types
 *   sdk.gen.ts, @angular/**               → api   (0.83: @angular/common/http/{requests,resources}.gen.ts)
 *   client.gen.ts, client/**, core/**     → core  (Client-Runtime, provideHeyApiClient)
 *   index.ts                              → verworfen
 */
import { listTsFiles } from './files.mjs';

const isApi = (file) => file === 'sdk.gen.ts' || file.startsWith('@angular/');

/** Überschreibbar per nx.json `generator.options` (`plugins` ersetzt die Liste komplett). */
export const defaults = {
  plugins: [
    '@hey-api/client-angular',
    '@hey-api/typescript',
    '@hey-api/sdk',
    // injectable Klassen je Tag (<Tag>Requests: HttpRequest-Factories, <Tag>Resources: httpResource)
    { name: '@angular/common', httpRequests: { asClass: true }, httpResources: { asClass: true } },
  ],
};

/** @type {import('../contract').GeneratorAdapter} */
export const heyApiAdapter = {
  id: 'hey-api',
  async generate({ specFile, outDir, options }) {
    // gepinnt auf 0.83.x: Node >= 22.10 (ab 0.96 >= 22.13, ab 0.98 >= 22.18, lokal 22.16), Peer von nx-plugin-openapi
    const { createClient } = await import('@hey-api/openapi-ts');
    await createClient({
      ...options,
      // absolut: ein relativer Pfad wie `specs/x.yaml` würde als Registry-Kurzform org/project gelesen
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

/** Auch vom nx-plugin-openapi-Adapter genutzt (gleiche Ausgabe). */
export function classifyHeyApi(outDir) {
    const files = listTsFiles(outDir);
    return {
      models: files.filter((file) => file === 'types.gen.ts'),
      apis: files.filter(isApi),
      core: files.filter((file) => file === 'client.gen.ts' || file.startsWith('client/') || file.startsWith('core/')),
      entries: {
        api: files.filter(isApi),
        // core/*.gen.ts sind intern, client/index.ts re-exportiert, was gebraucht wird
        core: ['client.gen.ts', 'client/index.ts'],
      },
    };
}
