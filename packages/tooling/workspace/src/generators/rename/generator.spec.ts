import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { APP_ROUTES, createBlueprintTree, read, scopesOf } from '@blueprint/tooling-conventions/testing';
import { domainGenerator } from '../domain/generator';
import { featGenerator } from '../feat/generator';
import { findLazyRoutes } from '../shared/routes';
import { listLibPaths } from '../shared/workspace';
import { renameGenerator } from './generator';

describe('rename generator', () => {
  let tree: Tree;
  beforeEach(async () => {
    tree = createBlueprintTree();
    await domainGenerator(tree, { name: 'payment' });
    await featGenerator(tree, { domain: 'payment', name: 'checkout', state: true });
  });

  it('renames a domain: libs, imports (static + import()), route path, scope list', async () => {
    await renameGenerator(tree, { path: 'payment', name: 'billing' });

    expect(listLibPaths(tree, 'payment')).toEqual([]);
    expect(listLibPaths(tree, 'billing')).toContain('billing/feat-checkout/state');
    expect(read(tree, 'libs/billing/state/src/payment.store.spec.ts')).toContain("from '@blueprint/billing/testing'");
    expect(read(tree, 'libs/billing/shell/src/payment.routes.ts')).toContain("import('@blueprint/billing/feat-checkout/feature')");
    const appRoutes = findLazyRoutes(read(tree, APP_ROUTES)).map((route) => [route.path, route.specifier]);
    expect(appRoutes).toContainEqual(['billing', '@blueprint/billing/shell']);
    expect(scopesOf(tree)).toEqual(['billing', 'booking', 'layout', 'shared']);
  });

  it('renames a feat (with or without feat- prefix) and its route path', async () => {
    await renameGenerator(tree, { path: 'payment/feat-checkout', name: 'feat-pay' });

    expect(listLibPaths(tree, 'payment/feat-pay')).toEqual(['payment/feat-pay/feature', 'payment/feat-pay/state']);
    const shellRoutes = findLazyRoutes(read(tree, 'libs/payment/shell/src/payment.routes.ts'));
    expect(shellRoutes.map((route) => [route.path, route.specifier])).toEqual([['pay', '@blueprint/payment/feat-pay/feature']]);
  });

  it('validates the new name', async () => {
    await expect(renameGenerator(tree, { path: 'payment', name: 'Billing' })).rejects.toThrow('kebab-case');
  });
});
