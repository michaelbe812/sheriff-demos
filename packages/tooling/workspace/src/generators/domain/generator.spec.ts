import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveTags } from '@blueprint/tooling-conventions';
import { APP_ROUTES, createBlueprintTree, pathsOf, read, scopesOf } from '@blueprint/tooling-conventions/testing';
import { findLazyRoutes } from '../shared/routes';
import { listLibPaths } from '../shared/workspace';
import { readJsonFile } from '@blueprint/tooling-conventions/tree';
import { domainGenerator } from './generator';

describe('domain generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('creates one lib per layer + testing, each a valid blueprint lib', async () => {
    await domainGenerator(tree, { name: 'payment' });

    const libs = listLibPaths(tree, 'payment');
    expect(libs).toEqual([
      'payment/data-access',
      'payment/shell',
      'payment/state',
      'payment/testing',
      'payment/types',
      'payment/ui',
    ]);
    for (const lib of libs) expect(() => deriveTags(lib, { scopes: scopesOf(tree) })).not.toThrow();
  });

  it('writes the explicit config of every lib: testing without build files, state with spec config', async () => {
    await domainGenerator(tree, { name: 'payment' });

    const paths = pathsOf(tree);
    for (const lib of listLibPaths(tree, 'payment')) {
      expect(readJsonFile(tree, `libs/${lib}/project.json`)).toMatchObject({
        name: lib.replace('/', '-'),
        tags: deriveTags(lib, { scopes: scopesOf(tree) }),
      });
      expect(paths[`@blueprint/${lib}`]).toEqual([`./libs/${lib}/src/index.ts`]);
    }
    expect(tree.exists('libs/payment/testing/package.json')).toBe(false);
    expect(tree.exists('libs/payment/testing/ng-package.json')).toBe(false);
    expect(readJsonFile(tree, 'libs/payment/testing/project.json')).toMatchObject({
      targets: { lint: {}, typecheck: {} },
    });
    expect(readJsonFile(tree, 'libs/payment/state/project.json')).toMatchObject({
      targets: { build: {}, lint: {}, typecheck: {}, test: {} },
    });
    expect(tree.exists('libs/payment/state/tsconfig.spec.json')).toBe(true);
    expect(tree.exists('libs/payment/data-access/tsconfig.spec.json')).toBe(false);
    expect(tree.exists('libs/payment/ui/tsconfig.spec.json')).toBe(false);
    for (const removed of ['api', 'events', 'data']) expect(tree.exists(`libs/payment/${removed}`)).toBe(false);
    expect(readJsonFile(tree, 'libs/payment/shell/package.json')).toMatchObject({
      peerDependencies: { '@angular/core': '^22.0.0', '@angular/router': '^22.0.0' },
    });
  });

  it('writes examples in the slice style (data-access = HTTP over ApiHttp, state = store, OnPush ui, routes + providers)', async () => {
    await domainGenerator(tree, { name: 'payment' });

    expect(read(tree, 'libs/payment/data-access/src/payment-api.ts')).toContain(
      "import { ApiHttp } from '@blueprint/shared/data-access';",
    );
    expect(read(tree, 'libs/payment/data-access/src/index.ts')).toBe("export * from './payment-api';\n");
    expect(read(tree, 'libs/payment/state/src/index.ts')).toBe("export * from './payment.store';\n");
    expect(read(tree, 'libs/payment/state/src/payment.store.ts')).toContain('export class PaymentStore');
    expect(read(tree, 'libs/payment/state/src/payment.store.ts')).toContain(
      "import { PaymentApi } from '@blueprint/payment/data-access';",
    );
    expect(read(tree, 'libs/payment/shell/src/payment.providers.ts')).toContain("from '@blueprint/payment/state';");
    expect(read(tree, 'libs/payment/ui/src/payment-list.ts')).toContain('ChangeDetectionStrategy.OnPush');
    expect(read(tree, 'libs/payment/shell/src/index.ts')).toBe(
      "export * from './payment.routes';\nexport * from './payment.providers';\n",
    );
    expect(read(tree, 'libs/payment/shell/src/payment.routes.ts')).toContain('providers: [providePayment()]');
  });

  it('adds testing (fixtures, handlers, scenarios) and a state spec in the beforeEach/worker.use style', async () => {
    await domainGenerator(tree, { name: 'payment' });

    expect(read(tree, 'libs/payment/testing/src/index.ts')).toBe(
      "export * from './fixtures/payment.fixture';\nexport * from './handlers/payment.handlers';\n",
    );
    const handlers = read(tree, 'libs/payment/testing/src/handlers/payment.handlers.ts');
    expect(handlers).toContain('export const paymentHandlers');
    expect(handlers).toContain('export const paymentScenarios');
    expect(read(tree, 'libs/payment/testing/src/fixtures/payment.fixture.ts')).toContain(
      "import { Payment } from '@blueprint/payment/types';",
    );
    const spec = read(tree, 'libs/payment/state/src/payment.store.spec.ts');
    expect(spec).toContain('beforeEach(() => worker.use(...paymentHandlers));');
    expect(spec).toContain("import { test, worker } from '@blueprint/shared/testing';");
  });

  it('registers the shell lazily in the app routes, before the redirect', async () => {
    await domainGenerator(tree, { name: 'payment' });

    const routes = findLazyRoutes(read(tree, APP_ROUTES));
    expect(routes.map((route) => [route.path, route.specifier])).toEqual([
      ['bookings', '@blueprint/booking/shell'],
      ['payment', '@blueprint/payment/shell'],
    ]);
    expect(read(tree, APP_ROUTES)).toContain("import('@blueprint/payment/shell').then((m) => m.paymentRoutes)");
    expect(read(tree, APP_ROUTES).indexOf('payment')).toBeLessThan(
      read(tree, APP_ROUTES).indexOf("redirectTo: 'bookings'"),
    );
  });

  it('adds the scope to lib-scopes.json', async () => {
    await domainGenerator(tree, { name: 'payment' });

    expect(scopesOf(tree)).toEqual(['booking', 'layout', 'payment', 'shared']);
  });

  it('is idempotent', async () => {
    await domainGenerator(tree, { name: 'payment' });
    const routes = read(tree, APP_ROUTES);
    tree.write('libs/payment/state/src/payment.store.ts', '// edited\n');

    await domainGenerator(tree, { name: 'payment' });

    expect(read(tree, APP_ROUTES)).toBe(routes);
    expect(read(tree, 'libs/payment/state/src/payment.store.ts')).toBe('// edited\n');
    expect(scopesOf(tree)).toEqual(['booking', 'layout', 'payment', 'shared']);
  });

  it('respects --layers and checks their dependencies', async () => {
    await domainGenerator(tree, { name: 'notes', layers: 'types,utils', testing: false });
    expect(listLibPaths(tree, 'notes')).toEqual(['notes/types', 'notes/utils']);
    expect(findLazyRoutes(read(tree, APP_ROUTES)).map((route) => route.specifier)).not.toContain(
      '@blueprint/notes/shell',
    );

    await expect(domainGenerator(tree, { name: 'orders', layers: 'types,state' })).rejects.toThrow(
      'libs/orders/state needs libs/orders/data-access',
    );
    await expect(domainGenerator(tree, { name: 'orders', layers: 'data' })).rejects.toThrow('Unknown layer(s) data');
    await expect(domainGenerator(tree, { name: 'orders', layers: 'widgets' })).rejects.toThrow(
      'Unknown layer(s) widgets',
    );
  });

  it('rejects invalid names', async () => {
    await expect(domainGenerator(tree, { name: 'Payment' })).rejects.toThrow('kebab-case');
    await expect(domainGenerator(tree, { name: 'shared' })).rejects.toThrow('reserved');
  });
});
