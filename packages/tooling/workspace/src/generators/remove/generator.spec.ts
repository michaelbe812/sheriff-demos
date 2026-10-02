import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ROUTES, createBlueprintTree, read, scopesOf } from '@blueprint/tooling-conventions/testing';
import { domainGenerator } from '../domain/generator';
import { featGenerator } from '../feat/generator';
import { findLazyRoutes } from '../shared/routes';
import { listLibPaths } from '../shared/workspace';
import { removeGenerator } from './generator';

describe('remove generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('removes a domain with its app route, scope, config and paths; everything exactly as before', async () => {
    const before = read(tree, APP_ROUTES);
    const baseTsconfig = read(tree, 'tsconfig.base.json');
    const scopes = read(tree, 'lib-scopes.json');
    // skipFormat: prettier would use its defaults in the virtual tree (no .prettierrc)
    await domainGenerator(tree, { name: 'payment', skipFormat: true });
    await featGenerator(tree, { domain: 'payment', name: 'checkout', state: true, skipFormat: true });

    await removeGenerator(tree, { path: 'payment', skipFormat: true });

    expect(listLibPaths(tree, 'payment')).toEqual([]);
    expect(tree.exists('libs/payment')).toBe(false);
    expect(read(tree, APP_ROUTES)).toBe(before);
    expect(scopesOf(tree)).toEqual(['booking', 'layout', 'shared']);
    expect(read(tree, 'tsconfig.base.json')).toBe(baseTsconfig);
    expect(read(tree, 'lib-scopes.json')).toBe(scopes);
  });

  it('removes a feat and its shell route, keeps the scope', async () => {
    await removeGenerator(tree, { path: 'booking/feat-check-booking' });

    expect(findLazyRoutes(read(tree, 'libs/booking/shell/src/booking.routes.ts'))).toEqual([]);
    expect(scopesOf(tree)).toContain('booking');
  });

  it('refuses while other code imports it, unless --force', async () => {
    await expect(removeGenerator(tree, { path: 'booking/state' })).rejects.toThrow(
      /still imported by:\n {2}libs\/booking\/feat-check-booking\/feature\/src\/feat-check-booking.ts/,
    );
    expect(tree.exists('libs/booking/state/src/index.ts')).toBe(true);

    await removeGenerator(tree, { path: 'booking/state', force: true });
    expect(tree.exists('libs/booking/state/src/index.ts')).toBe(false);
  });

  it('ignores imports in comments', async () => {
    tree.write(
      'libs/layout/shell/src/example.ts',
      "// boundary-violation-example: import { X } from '@blueprint/booking/state';\nexport {};\n",
    );
    tree.write(
      'libs/booking/feat-check-booking/feature/src/feat-check-booking.ts',
      'export class FeatCheckBooking {}\n',
    );

    await removeGenerator(tree, { path: 'booking/state' });

    expect(tree.exists('libs/booking/state/src/index.ts')).toBe(false);
  });

  it('counts a static import of a shell as import, a lazy route not', async () => {
    tree.write('libs/layout/shell/src/uses.ts', "export { bookingRoutes } from '@blueprint/booking/shell';\n");
    await expect(removeGenerator(tree, { path: 'booking' })).rejects.toThrow('libs/layout/shell/src/uses.ts');
    expect(read(tree, APP_ROUTES)).toContain('@blueprint/booking/shell');
  });
});
