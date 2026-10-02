import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ROUTES, createBlueprintTree, pathsOf, read, scopesOf } from '@blueprint/tooling-conventions/testing';
import { domainGenerator } from '../domain/generator';
import { featGenerator } from '../feat/generator';
import { findLazyRoutes } from '../shared/routes';
import { listLibPaths } from '../shared/workspace';
import { readJsonFile } from '@blueprint/tooling-conventions/tree';
import { moveGenerator } from './generator';

describe('move generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('moves a lib and rewrites static imports', async () => {
    await moveGenerator(tree, { from: 'booking/data', to: 'booking/feat-check-booking/data' });

    expect(tree.exists('libs/booking/data/src/index.ts')).toBe(false);
    expect(read(tree, 'libs/booking/feat-check-booking/data/src/booking.store.ts')).toContain(
      'export class BookingStore',
    );
    expect(read(tree, 'libs/booking/feat-check-booking/feature/src/feat-check-booking.ts')).toContain(
      "from '@blueprint/booking/feat-check-booking/data'",
    );
  });

  it('keeps the config in step: name, tags, alias, relative paths, paths entry', async () => {
    await moveGenerator(tree, { from: 'booking/data', to: 'booking/feat-check-booking/data' });

    const root = 'libs/booking/feat-check-booking/data';
    expect(readJsonFile(tree, `${root}/project.json`)).toMatchObject({
      name: 'booking-feat-check-booking-data',
      $schema: '../../../../node_modules/nx/schemas/project-schema.json',
      sourceRoot: `${root}/src`,
      tags: ['scope:booking', 'type:data', 'feat:check-booking'],
    });
    expect(readJsonFile(tree, `${root}/package.json`)).toMatchObject({
      name: '@blueprint/booking/feat-check-booking/data',
    });
    expect(readJsonFile(tree, `${root}/ng-package.json`)).toMatchObject({
      dest: '../../../../dist/libs/booking/feat-check-booking/data',
    });
    expect(readJsonFile(tree, `${root}/tsconfig.json`)).toMatchObject({ extends: '../../../../tsconfig.base.json' });
    expect(readJsonFile(tree, `${root}/tsconfig.lib.json`)).toMatchObject({
      compilerOptions: { outDir: '../../../../dist/out-tsc' },
    });
    const paths = pathsOf(tree);
    expect(paths['@blueprint/booking/data']).toBeUndefined();
    expect(paths['@blueprint/booking/feat-check-booking/data']).toEqual([`./${root}/src/index.ts`]);
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
    expect(read(tree, 'libs/reservation/data/src/booking-api.ts')).toContain("from '@blueprint/reservation/types'");
    const appRoutes = findLazyRoutes(read(tree, APP_ROUTES));
    expect(appRoutes.map((route) => [route.path, route.specifier])).toEqual([
      ['bookings', '@blueprint/reservation/shell'],
    ]);
    expect(scopesOf(tree)).toEqual(['layout', 'reservation', 'shared']);
    expect(readJsonFile(tree, 'libs/reservation/shell/project.json')).toMatchObject({
      name: 'reservation-shell',
      tags: ['scope:reservation', 'type:feature', 'feat:none', 'entry'],
    });
  });

  it('never matches a longer alias (booking vs booking-x)', async () => {
    tree.write('libs/booking-x/utils/src/index.ts', 'export {};\n');
    tree.write(
      'libs/layout/shell/src/uses.ts',
      "import '@blueprint/booking-x/utils';\nimport '@blueprint/booking/data';\n",
    );

    await moveGenerator(tree, { from: 'booking', to: 'reservation' });

    expect(read(tree, 'libs/layout/shell/src/uses.ts')).toBe(
      "import '@blueprint/booking-x/utils';\nimport '@blueprint/reservation/data';\n",
    );
  });

  it('rejects invalid targets', async () => {
    await expect(moveGenerator(tree, { from: 'booking/data', to: 'booking/widgets' })).rejects.toThrow(
      'lib convention',
    );
    await expect(moveGenerator(tree, { from: 'booking/data', to: 'booking/types' })).rejects.toThrow('exists already');
    await expect(moveGenerator(tree, { from: 'booking/data', to: 'booking/api' })).rejects.toThrow('lib convention');
    await expect(moveGenerator(tree, { from: 'nope', to: 'other' })).rejects.toThrow('Nothing to move');
  });
});
