import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ROUTES, createBlueprintTree, read } from '@blueprint/tooling-conventions/testing';
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

  it('leaves an existing lib untouched', async () => {
    await layerGenerator(tree, { domain: 'booking', layer: 'api' });

    expect(read(tree, 'libs/booking/api/src/booking-api.ts')).toContain('export class BookingApi {}');
  });

  it('validates domain and layer (layer list from the plugin)', async () => {
    await expect(layerGenerator(tree, { domain: 'payment', layer: 'ui' })).rejects.toThrow('Unknown scope "payment"');
    await expect(layerGenerator(tree, { domain: 'booking', layer: 'widgets' })).rejects.toThrow(
      'allowed: types, utils, events, api, state, ui, shell, testing',
    );
    await expect(layerGenerator(tree, { domain: 'booking', layer: 'feature' })).rejects.toThrow('only exists inside a feat');
  });

  it('checks the layers the example imports', async () => {
    tree.write('libs/notes/types/src/index.ts', 'export {};\n');
    tree.write('nx.json', read(tree, 'nx.json').replace('"booking",', '"booking", "notes",'));

    await expect(layerGenerator(tree, { domain: 'notes', layer: 'shell' })).rejects.toThrow('needs libs/notes/state, libs/notes/ui');
  });

  it('registers a new shell in the app routes', async () => {
    tree.write('nx.json', read(tree, 'nx.json').replace('"booking",', '"booking", "notes",'));
    tree.write('libs/notes/types/src/index.ts', 'export interface Notes {\n  id: string;\n  name: string;\n}\n');
    for (const layer of ['api', 'state', 'ui', 'shell']) await layerGenerator(tree, { domain: 'notes', layer });

    expect(findLazyRoutes(read(tree, APP_ROUTES)).map((route) => route.specifier)).toContain('@blueprint/notes/shell');
  });
});
