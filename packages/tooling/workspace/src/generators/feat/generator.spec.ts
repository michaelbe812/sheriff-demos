import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveTags } from '@blueprint/tooling-conventions';
import { createBlueprintTree, read, scopesOf } from '@blueprint/tooling-conventions/testing';
import { domainGenerator } from '../domain/generator';
import { findLazyRoutes } from '../shared/routes';
import { listLibPaths } from '../shared/workspace';
import { featGenerator } from './generator';

describe('feat generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
  });

  it('creates the feature container and only the requested sub-libs', async () => {
    await featGenerator(tree, { domain: 'booking', name: 'rebook', api: true, state: true });

    const libs = listLibPaths(tree, 'booking/feat-rebook');
    expect(libs).toEqual(['booking/feat-rebook/api', 'booking/feat-rebook/feature', 'booking/feat-rebook/state']);
    expect(deriveTags('booking/feat-rebook/api', { scopes: scopesOf(tree) })).toContain('feat-port');
    const container = read(tree, 'libs/booking/feat-rebook/feature/src/feat-rebook.ts');
    expect(container).toContain("import { RebookStore } from '@blueprint/booking/feat-rebook/state';");
    expect(container).toContain('providers: [RebookStore]');
    expect(container).not.toContain('RebookView');
    expect(read(tree, 'libs/booking/feat-rebook/state/src/rebook.store.ts')).toContain(
      "import { describeRebook } from '@blueprint/booking/feat-rebook/api';",
    );
  });

  it('wires the ui into the container', async () => {
    await featGenerator(tree, { domain: 'booking', name: 'rebook', state: true, ui: true });

    const container = read(tree, 'libs/booking/feat-rebook/feature/src/feat-rebook.ts');
    expect(container).toContain('imports: [RebookView]');
    expect(container).toContain('<app-rebook-view');
    expect(container).toContain('[items]="store.items()"');
    expect(container).toContain('(selected)="store.select($event)"');
  });

  it('adds a lazy route to the shell routes of the domain (top-level array)', async () => {
    await featGenerator(tree, { domain: 'booking', name: 'rebook' });

    const routes = findLazyRoutes(read(tree, 'libs/booking/shell/src/booking.routes.ts'));
    expect(routes.map((route) => [route.path, route.specifier])).toEqual([
      ['', '@blueprint/booking/feat-check-booking/feature'],
      ['rebook', '@blueprint/booking/feat-rebook/feature'],
    ]);
    expect(read(tree, 'libs/booking/shell/src/booking.routes.ts')).toContain('m.FeatRebook');
  });

  it('adds the route into the children of a generated domain shell', async () => {
    await domainGenerator(tree, { name: 'payment' });
    await featGenerator(tree, { domain: 'payment', name: 'feat-checkout', api: true, state: true });

    const shellRoutes = read(tree, 'libs/payment/shell/src/payment.routes.ts');
    expect(shellRoutes).toMatch(/children: \[\s*\{ path: '', component: PaymentPage \},\s*\{\s*path: 'checkout',/);
  });

  it('is idempotent and validates the domain', async () => {
    await featGenerator(tree, { domain: 'booking', name: 'rebook', state: true });
    const routes = read(tree, 'libs/booking/shell/src/booking.routes.ts');
    await featGenerator(tree, { domain: 'booking', name: 'rebook', state: true });
    expect(read(tree, 'libs/booking/shell/src/booking.routes.ts')).toBe(routes);

    await expect(featGenerator(tree, { domain: 'payment', name: 'x' })).rejects.toThrow('Unknown scope "payment"');
    await expect(featGenerator(tree, { domain: 'booking', name: 'Re_book' })).rejects.toThrow('kebab-case');
  });
});
