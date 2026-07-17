import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import domainGenerator from '../src/generators/domain/generator';
import featGenerator from '../src/generators/feat/generator';
import sharedFeatureGenerator from '../src/generators/shared-feature/generator';

describe('domain generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: { paths: {} } }));
  });

  it('scaffolds a lib domain with all buckets, project files and alias', async () => {
    await domainGenerator(tree, { name: 'inventory', feat: 'stock-count' });

    const root = 'libs/domains/inventory/src';
    for (const file of [
      `${root}/inventory.routes.ts`,
      `${root}/types/inventory.model.ts`,
      `${root}/utils/inventory.utils.ts`,
      `${root}/events/inventory.events.ts`,
      `${root}/api/inventory-api.ts`,
      `${root}/data/inventory.store.ts`,
      `${root}/feat-stock-count/feat-stock-count.ts`,
      `${root}/feat-stock-count/api/stock-count-api.ts`,
      `${root}/feat-stock-count/data/stock-count.store.ts`,
      'libs/domains/inventory/project.json',
      'libs/domains/inventory/tsconfig.json',
    ]) {
      expect(tree.exists(file), file).toBe(true);
    }

    const baseTsconfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);
    expect(baseTsconfig.compilerOptions.paths['@blueprint/domains/inventory/*']).toEqual([
      './libs/domains/inventory/src/*',
    ]);

    expect(tree.read(`${root}/api/inventory-api.ts`, 'utf-8')).toContain('PUBLIC PORT');
    expect(tree.read('libs/domains/inventory/project.json', 'utf-8')).toContain('"domain-inventory"');
  });

  it('scaffolds an app-internal domain without lib plumbing', async () => {
    await domainGenerator(tree, { name: 'billing', app: 'client' });

    expect(tree.exists('apps/client/src/app/domains/billing/billing.routes.ts')).toBe(true);
    expect(tree.exists('apps/client/src/app/domains/billing/api/billing-api.ts')).toBe(true);
    expect(tree.exists('libs/domains/billing')).toBe(false);
    const baseTsconfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);
    expect(baseTsconfig.compilerOptions.paths['@blueprint/domains/billing/*']).toBeUndefined();
  });

  it('respects a custom alias prefix', async () => {
    await domainGenerator(tree, { name: 'inventory', aliasPrefix: '@acme' });
    const baseTsconfig = JSON.parse(tree.read('tsconfig.base.json', 'utf-8')!);
    expect(baseTsconfig.compilerOptions.paths['@acme/domains/inventory/*']).toBeDefined();
  });
});

describe('feat generator', () => {
  it('scaffolds a feat with feat-port inside an existing domain', async () => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('tsconfig.base.json', JSON.stringify({ compilerOptions: {} }));
    await domainGenerator(tree, { name: 'inventory' });

    await featGenerator(tree, { name: 'restock', domain: 'inventory' });

    const root = 'libs/domains/inventory/src/feat-restock';
    expect(tree.exists(`${root}/feat-restock.ts`)).toBe(true);
    expect(tree.read(`${root}/api/restock-api.ts`, 'utf-8')).toContain('FEAT-PORT');
    expect(tree.exists(`${root}/data/restock.store.ts`)).toBe(true);
  });

  it('fails when the domain does not exist', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await expect(featGenerator(tree, { name: 'x', domain: 'nope' })).rejects.toThrow(/not found/);
  });
});

describe('shared-feature generator', () => {
  it('scaffolds port contract, store and providers at the app root', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await sharedFeatureGenerator(tree, { name: 'notifications', app: 'client' });

    const root = 'apps/client/src/app/notifications';
    const api = tree.read(`${root}/api/notifications-api.ts`, 'utf-8')!;
    expect(api).toContain('NOTIFICATIONS_API');
    expect(api).toContain('InjectionToken');
    expect(tree.read(`${root}/notifications.providers.ts`, 'utf-8')).toContain('provideNotifications');
    expect(tree.exists(`${root}/data/notifications.store.ts`)).toBe(true);
  });

  it('scaffolds a lib shared feature under libs/<name>/src', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await sharedFeatureGenerator(tree, { name: 'auth' });
    expect(tree.exists('libs/auth/src/api/auth-api.ts')).toBe(true);
  });
});
