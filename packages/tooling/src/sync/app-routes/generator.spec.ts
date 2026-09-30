import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ROUTES, createBlueprintTree, read } from '../../testing/blueprint-tree';
import { domainGenerator } from '../../generators/domain/generator';
import { findLazyRoutes } from '../../generators/shared/routes';
import { appRoutesSyncGenerator } from './generator';

describe('app-routes sync generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('is in sync for a consistent workspace (no changes, no message)', async () => {
    const before = read(tree, APP_ROUTES);

    expect(await appRoutesSyncGenerator(tree)).toBeUndefined();
    expect(read(tree, APP_ROUTES)).toBe(before);
  });

  it('registers a slice shell missing in the app routes', async () => {
    await domainGenerator(tree, { name: 'payment' });
    tree.write(APP_ROUTES, read(tree, APP_ROUTES).replace(/\{\s*path: 'payment',[^}]*\},/s, ''));
    expect(findLazyRoutes(read(tree, APP_ROUTES)).map((r) => r.specifier)).not.toContain('@blueprint/payment/shell');

    const result = await appRoutesSyncGenerator(tree);

    expect(result?.outOfSyncDetails).toEqual([`${APP_ROUTES}: libs/payment/shell was not registered — added route "payment"`]);
    expect(findLazyRoutes(read(tree, APP_ROUTES)).map((r) => r.specifier)).toContain('@blueprint/payment/shell');
  });

  it('removes routes to libs that do not exist (app routes and slice shell routes)', async () => {
    tree.delete('libs/booking/feat-check-booking/feature/src/index.ts');
    tree.write(
      APP_ROUTES,
      read(tree, APP_ROUTES).replace(
        "{ path: '', pathMatch",
        "{ path: 'ghost', loadChildren: () => import('@blueprint/ghost/shell').then((m) => m.ghostRoutes) },\n      { path: '', pathMatch",
      ),
    );

    const result = await appRoutesSyncGenerator(tree);

    expect(result?.outOfSyncDetails).toHaveLength(2);
    expect(findLazyRoutes(read(tree, APP_ROUTES)).map((r) => r.specifier)).toEqual(['@blueprint/booking/shell']);
    expect(findLazyRoutes(read(tree, 'libs/booking/shell/src/booking.routes.ts'))).toEqual([]);
  });

  it('ignores shells without Routes (providers/component entries) and non-blueprint imports', async () => {
    tree.write('libs/auth/shell/src/index.ts', 'export function provideAuth() {}\n');
    tree.write(APP_ROUTES, read(tree, APP_ROUTES).replace("{ path: '', pathMatch", "{ path: 'x', loadComponent: () => import('./x').then((m) => m.X) },\n      { path: '', pathMatch"));

    expect(await appRoutesSyncGenerator(tree)).toBeUndefined();
  });
});
