/**
 * Pfad-Konvention generierter OpenAPI-Clients (gemeinsam für blueprint-libs.ts und blueprint-openapi-clients.ts):
 *
 *   libs/generated/<client>/                 scope:shared     (shared Client)
 *   libs/<domain>/generated/<client>/        scope:<domain>   (Domain-eigener Client)
 *     openapi.yaml                           committet: Spec = Marker des Client-Projekts (Target generate)
 *     types/src/index.ts                     committet: export * from './generated'   type:types
 *     api/src/index.ts                       committet                                 type:api
 *     core/src/index.ts                      committet, optional                        type:api (enthält HTTP)
 *     <part>/src/generated/**                gitignored, von `generate` geschrieben
 */

export const GENERATED_FOLDER = 'generated';
export const SPEC_FILE = 'openapi.yaml';

/** Teil → Layer. core ist `api`, nicht `utils`: Configuration/Encoder/Client-Runtime importieren @angular/common/http. */
export const GENERATED_PART_LAYERS = { types: 'types', api: 'api', core: 'api' } as const;
export type GeneratedPart = keyof typeof GENERATED_PART_LAYERS;

export interface ClientLocation {
  /** Pfad unter libs/, z.B. booking/generated/booking-client */
  clientPath: string;
  name: string;
  scope: string;
  placement: 'shared' | { domain: string };
}

/** Client aus einem Pfad unter libs/ (Client-Ordner), undefined wenn kein generated-Pfad. */
export function parseClientPath(clientPath: string): ClientLocation | undefined {
  const segments = clientPath.split('/');
  const index = segments.indexOf(GENERATED_FOLDER);
  if (index === -1) return undefined;
  const shared = index === 0 && segments.length === 2;
  const domain = index === 1 && segments.length === 3;
  if (!shared && !domain) {
    throw new Error(`libs/${clientPath}: generierter Client muss libs/generated/<client> oder libs/<domain>/generated/<client> sein`);
  }
  const name = segments.at(-1) as string;
  return shared
    ? { clientPath, name, scope: 'shared', placement: 'shared' }
    : { clientPath, name, scope: segments[0], placement: { domain: segments[0] } };
}

/** Teil-Lib eines Clients aus ihrem Pfad unter libs/ (z.B. generated/pet-client/api). */
export function parseGeneratedLibPath(libPath: string): (ClientLocation & { part: GeneratedPart }) | undefined {
  if (!libPath.split('/').includes(GENERATED_FOLDER)) return undefined;
  const part = libPath.split('/').at(-1) as string;
  if (!(part in GENERATED_PART_LAYERS)) {
    throw new Error(`libs/${libPath}: Teil-Lib eines generierten Clients muss ${Object.keys(GENERATED_PART_LAYERS).join('|')} heißen`);
  }
  const client = parseClientPath(libPath.slice(0, -(part.length + 1)));
  return client && { ...client, part: part as GeneratedPart };
}

export const projectNameFor = (pathBelowLibs: string) => pathBelowLibs.replaceAll('/', '-');
