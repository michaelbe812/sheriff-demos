import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveTags } from '@blueprint/tooling-conventions';
import { APP_ROUTES, createBlueprintTree, read, scopesOf } from '@blueprint/tooling-conventions/testing';
import { findLazyRoutes } from '../shared/routes';
import { listLibPaths } from '../shared/workspace';
import { domainGenerator } from './generator';

describe('domain generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('creates one lib per layer + testing, each a valid blueprint lib', async () => {
    await domainGenerator(tree, { name: 'payment' });

    const libs = listLibPaths(tree, 'payment');
    expect(libs).toEqual(['payment/api', 'payment/data', 'payment/shell', 'payment/testing', 'payment/types', 'payment/ui']);
    for (const lib of libs) expect(() => deriveTags(lib, { scopes: scopesOf(tree) })).not.toThrow();
  });

  it('writes examples in the slice style (port over ApiHttp, store, OnPush ui, routes + providers)', async () => {
    await domainGenerator(tree, { name: 'payment' });

    expect(read(tree, 'libs/payment/api/src/payment-api.ts')).toContain("import { ApiHttp } from '@blueprint/shared/api';");
    expect(read(tree, 'libs/payment/api/src/index.ts')).toBe("export * from './payment-api';\n");
    expect(read(tree, 'libs/payment/data/src/payment.store.ts')).toContain('export class PaymentStore');
    expect(read(tree, 'libs/payment/ui/src/payment-list.ts')).toContain('ChangeDetectionStrategy.OnPush');
    expect(read(tree, 'libs/payment/shell/src/index.ts')).toBe("export * from './payment.routes';\nexport * from './payment.providers';\n");
    expect(read(tree, 'libs/payment/shell/src/payment.routes.ts')).toContain('providers: [providePayment()]');
  });

  it('adds testing (fixtures, handlers, scenarios) and a data spec in the beforeEach/worker.use style', async () => {
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
    const spec = read(tree, 'libs/payment/data/src/payment.store.spec.ts');
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
    expect(read(tree, APP_ROUTES).indexOf('payment')).toBeLessThan(read(tree, APP_ROUTES).indexOf("redirectTo: 'bookings'"));
  });

  it('adds the scope to the list in nx.json', async () => {
    await domainGenerator(tree, { name: 'payment' });

    expect(scopesOf(tree)).toEqual(['booking', 'layout', 'payment', 'shared']);
  });

  it('is idempotent', async () => {
    await domainGenerator(tree, { name: 'payment' });
    const routes = read(tree, APP_ROUTES);
    tree.write('libs/payment/data/src/payment.store.ts', '// edited\n');

    await domainGenerator(tree, { name: 'payment' });

    expect(read(tree, APP_ROUTES)).toBe(routes);
    expect(read(tree, 'libs/payment/data/src/payment.store.ts')).toBe('// edited\n');
    expect(scopesOf(tree)).toEqual(['booking', 'layout', 'payment', 'shared']);
  });

  it('respects --layers and checks their dependencies', async () => {
    await domainGenerator(tree, { name: 'notes', layers: 'types,utils', testing: false });
    expect(listLibPaths(tree, 'notes')).toEqual(['notes/types', 'notes/utils']);
    expect(findLazyRoutes(read(tree, APP_ROUTES)).map((route) => route.specifier)).not.toContain('@blueprint/notes/shell');

    await expect(domainGenerator(tree, { name: 'orders', layers: 'data' })).rejects.toThrow('libs/orders/data needs');
    await expect(domainGenerator(tree, { name: 'orders', layers: 'widgets' })).rejects.toThrow('Unknown layer(s) widgets');
  });

  it('rejects invalid names', async () => {
    await expect(domainGenerator(tree, { name: 'Payment' })).rejects.toThrow('kebab-case');
    await expect(domainGenerator(tree, { name: 'shared' })).rejects.toThrow('reserved');
  });
});
