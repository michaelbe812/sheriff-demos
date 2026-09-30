/**
 * Testing lib (libs/<slice>/testing): fixtures (builders) + MSW handlers (defaults) + scenarios
 * (deviations per test). Imports only msw, the slice's types and shared/testing.
 */
import { aliasFor } from '../../plugin/lib-conventions';
import type { LibFiles, SliceNames } from './slice-templates';

/**
 * @param entityInTypes true if `libs/<slice>/types` exports the entity interface; otherwise the
 *   fixture declares the backend shape itself (a testing lib may not import api/data).
 */
export function testingFiles(n: SliceNames, entityInTypes: boolean): LibFiles {
  const entityImport = entityInTypes
    ? `import { ${n.entity} } from '${aliasFor(`${n.scope}/types`)}';\n`
    : `/** Backend shape served by the handlers (no ${n.entity} in ${aliasFor(`${n.scope}/types`)} yet — move it there). */
export interface ${n.entity} {
  id: string;
  name: string;
}
`;
  const handlerImport = entityInTypes ? `import { ${n.entity} } from '${aliasFor(`${n.scope}/types`)}';\n` : '';
  const fixtureImport = entityInTypes ? `a${n.entity}` : `a${n.entity}, ${n.entity}`;
  return {
    files: {
      [`fixtures/${n.scope}.fixture.ts`]: `${entityImport}
let nextId = 1;

/** Test data builder: a valid entry, override what the test cares about. */
export function a${n.entity}(overrides: Partial<${n.entity}> = {}): ${n.entity} {
  return {
    id: \`${n.scope}-\${nextId++}\`,
    name: 'Example ${n.scope}',
    ...overrides,
  };
}
`,
      [`handlers/${n.scope}.handlers.ts`]: `${handlerImport}import { http, HttpResponse } from 'msw';
import { ${fixtureImport} } from '../fixtures/${n.scope}.fixture';

/** Backend contract of the ${n.scope} slice (mirrors ${n.entity}Api). */
export const ${n.property}Url = '${n.url}';

export const default${n.entity}Items: ${n.entity}[] = [
  a${n.entity}({ id: '${n.scope}-100', name: 'First ${n.scope}' }),
  a${n.entity}({ id: '${n.scope}-101', name: 'Second ${n.scope}' }),
];

/** Happy path, set per spec: \`beforeEach(() => worker.use(...${n.property}Handlers))\`. */
export const ${n.property}Handlers = [http.get(${n.property}Url, () => HttpResponse.json(default${n.entity}Items))];

/** Deviations for a single test: \`worker.use(${n.property}Scenarios.serverError())\`. */
export const ${n.property}Scenarios = {
  withItems: (items: ${n.entity}[]) => http.get(${n.property}Url, () => HttpResponse.json(items)),
  empty: () => http.get(${n.property}Url, () => HttpResponse.json([])),
  serverError: () => http.get(${n.property}Url, () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
};
`,
    },
    exports: [`fixtures/${n.scope}.fixture`, `handlers/${n.scope}.handlers`],
  };
}
