import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ROUTES, createBlueprintTree, read, scopesOf } from '../../testing/blueprint-tree';
import { domainGenerator } from '../domain/generator';
import { featGenerator } from '../feat/generator';
import { findLazyRoutes } from '../shared/routes';
import { listLibPaths } from '../shared/workspace';
import { moveGenerator } from './generator';

describe('move generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('moves a lib and rewrites static imports', async () => {
    await moveGenerator(tree, { from: 'booking/data', to: 'booking/feat-check-booking/data' });

    expect(tree.exists('libs/booking/data/src/index.ts')).toBe(false);
    expect(read(tree, 'libs/booking/feat-check-booking/data/src/booking.store.ts')).toContain('export class BookingStore');
    expect(read(tree, 'libs/booking/feat-check-booking/feature/src/feat-check-booking.ts')).toContain(
      "from '@blueprint/booking/feat-check-booking/data'",
    );
  });

  it('moves a feat within its domain and follows with route path + dynamic import', async () => {
    await moveGenerator(tree, { from: 'libs/booking/feat-check-booking', to: 'booking/feat-verify' });

    expect(listLibPaths(tree, 'booking/feat-verify')).toEqual(['booking/feat-verify/feature']);
    const routes = findLazyRoutes(read(tree, 'libs/booking/shell/src/booking.routes.ts'));
    expect(routes.map((route) => route.specifier)).toEqual(['@blueprint/booking/feat-verify/feature']);
  });

  it('moves a feat to another domain: route leaves the old shell, joins the new one', async () => {
    await domainGenerator(tree, { name: 'payment' });
    await featGenerator(tree, { domain: 'booking', name: 'rebook' });

    await moveGenerator(tree, { from: 'booking/feat-rebook', to: 'payment/feat-rebook' });

    expect(read(tree, 'libs/booking/shell/src/booking.routes.ts')).not.toContain('feat-rebook');
    const paymentRoutes = findLazyRoutes(read(tree, 'libs/payment/shell/src/payment.routes.ts'));
    expect(paymentRoutes.map((route) => [route.path, route.specifier])).toEqual([
      ['rebook', '@blueprint/payment/feat-rebook/feature'],
    ]);
  });

  it('moves a whole domain: imports, app route + path, scope list', async () => {
    await moveGenerator(tree, { from: 'booking', to: 'reservation' });

    expect(listLibPaths(tree, 'booking')).toEqual([]);
    expect(read(tree, 'libs/reservation/data/src/booking.store.ts')).toContain("from '@blueprint/reservation/api'");
    const appRoutes = findLazyRoutes(read(tree, APP_ROUTES));
    expect(appRoutes.map((route) => [route.path, route.specifier])).toEqual([['bookings', '@blueprint/reservation/shell']]);
    expect(scopesOf(tree)).toEqual(['layout', 'reservation', 'shared']);
  });

  it('never matches a longer alias (booking vs booking-x)', async () => {
    tree.write('libs/booking-x/utils/src/index.ts', 'export {};\n');
    tree.write('libs/layout/shell/src/uses.ts', "import '@blueprint/booking-x/utils';\nimport '@blueprint/booking/api';\n");

    await moveGenerator(tree, { from: 'booking', to: 'reservation' });

    expect(read(tree, 'libs/layout/shell/src/uses.ts')).toBe(
      "import '@blueprint/booking-x/utils';\nimport '@blueprint/reservation/api';\n",
    );
  });

  it('rejects invalid targets', async () => {
    await expect(moveGenerator(tree, { from: 'booking/data', to: 'booking/widgets' })).rejects.toThrow('lib convention');
    await expect(moveGenerator(tree, { from: 'booking/data', to: 'booking/api' })).rejects.toThrow('exists already');
    await expect(moveGenerator(tree, { from: 'nope', to: 'other' })).rejects.toThrow('Nothing to move');
  });
});
