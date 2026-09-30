import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ROUTES, createBlueprintTree, pathsOf, read } from '@blueprint/tooling-conventions/testing';
import { addScope, readJsonFile } from '@blueprint/tooling-conventions/tree';
import { findLazyRoutes } from '../shared/routes';
import { layerGenerator } from './generator';

describe('layer generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('adds a lib with an example to an existing domain', async () => {
    await layerGenerator(tree, { domain: 'booking', layer: 'events' });

    expect(read(tree, 'libs/booking/events/src/index.ts')).toBe("export * from './booking.events';\n");
    expect(read(tree, 'libs/booking/events/src/booking.events.ts')).toContain('export interface BookingSelected');
  });

  it('writes the explicit config: project.json (tags from the path), build files, paths entry', async () => {
    await layerGenerator(tree, { domain: 'booking', layer: 'ui' });

    const root = 'libs/booking/ui';
    expect(readJsonFile(tree, `${root}/project.json`)).toMatchObject({
      name: 'booking-ui',
      sourceRoot: `${root}/src`,
      tags: ['scope:booking', 'type:ui', 'feat:none'],
      targets: { build: {}, lint: {}, typecheck: {} },
    });
    expect(readJsonFile(tree, `${root}/package.json`)).toEqual({
      name: '@blueprint/booking/ui',
      version: '0.0.1',
      private: true,
      peerDependencies: { '@angular/core': '^22.0.0' },
      sideEffects: false,
    });
    expect(readJsonFile(tree, `${root}/ng-package.json`)).toMatchObject({ dest: '../../../dist/libs/booking/ui' });
    for (const file of ['tsconfig.json', 'tsconfig.lib.json', 'tsconfig.lib.prod.json'])
      expect(tree.exists(`${root}/${file}`)).toBe(true);
    expect(tree.exists(`${root}/tsconfig.spec.json`)).toBe(false);
    expect(pathsOf(tree)['@blueprint/booking/ui']).toEqual(['./libs/booking/ui/src/index.ts']);
  });

  it('leaves an existing lib untouched', async () => {
    await layerGenerator(tree, { domain: 'booking', layer: 'api' });

    expect(read(tree, 'libs/booking/api/src/booking-api.ts')).toContain('export class BookingApi {}');
  });

  it('validates domain and layer (layer list from the conventions)', async () => {
    await expect(layerGenerator(tree, { domain: 'payment', layer: 'ui' })).rejects.toThrow('Unknown scope "payment"');
    await expect(layerGenerator(tree, { domain: 'booking', layer: 'widgets' })).rejects.toThrow(
      'allowed: types, utils, events, api, data, ui, shell, testing',
    );
    await expect(layerGenerator(tree, { domain: 'booking', layer: 'feature' })).rejects.toThrow(
      'only exists inside a feat',
    );
  });

  it('checks the layers the example imports', async () => {
    tree.write('libs/notes/types/src/index.ts', 'export {};\n');
    addScope(tree, 'notes');

    await expect(layerGenerator(tree, { domain: 'notes', layer: 'shell' })).rejects.toThrow(
      'needs libs/notes/data, libs/notes/ui',
    );
  });

  it('registers a new shell in the app routes', async () => {
    addScope(tree, 'notes');
    tree.write('libs/notes/types/src/index.ts', 'export interface Notes {\n  id: string;\n  name: string;\n}\n');
    for (const layer of ['api', 'data', 'ui', 'shell']) await layerGenerator(tree, { domain: 'notes', layer });

    expect(findLazyRoutes(read(tree, APP_ROUTES)).map((route) => route.specifier)).toContain('@blueprint/notes/shell');
  });
});
