import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBlueprintTree, read } from '@blueprint/tooling-conventions/testing';
import { componentGenerator } from '../component/generator';
import { serviceGenerator } from '../service/generator';
import { storeGenerator } from '../store/generator';

describe('component / service / store wrappers', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
    tree.write('libs/booking/ui/src/index.ts', 'export {};\n');
  });

  it('component: OnPush standalone component, exported from index.ts', async () => {
    await componentGenerator(tree, { path: 'libs/booking/ui/src/badges/booking-badge' });

    const component = read(tree, 'libs/booking/ui/src/badges/booking-badge.ts');
    expect(component).toContain("selector: 'app-booking-badge'");
    expect(component).toContain('ChangeDetectionStrategy.OnPush');
    expect(component).toContain('export class BookingBadge');
    expect(read(tree, 'libs/booking/ui/src/index.ts')).toBe("export * from './badges/booking-badge';\n");
  });

  it('service: root-provided injectable, path without src/ works too', async () => {
    await serviceGenerator(tree, { path: 'booking/state/booking-cache', export: false });

    expect(read(tree, 'libs/booking/state/src/booking-cache.ts')).toContain('export class BookingCache');
    expect(read(tree, 'libs/booking/state/src/index.ts')).toBe("export * from './booking.store';\n");
  });

  it('store: <name>.store.ts with <Name>Store', async () => {
    await storeGenerator(tree, { path: 'libs/booking/ui/src/booking-filter' });

    expect(read(tree, 'libs/booking/ui/src/booking-filter.store.ts')).toContain('export class BookingFilterStore');
    expect(read(tree, 'libs/booking/ui/src/index.ts')).toBe("export * from './booking-filter.store';\n");
  });

  it('validates lib, layer and existing files', async () => {
    await expect(componentGenerator(tree, { path: 'libs/booking/state/src/card' })).rejects.toThrow('ui/feature/shell lib');
    await expect(componentGenerator(tree, { path: 'libs/nope/ui/src/card' })).rejects.toThrow('is no lib');
    await storeGenerator(tree, { path: 'booking/state/src/booking-cache' });
    await expect(storeGenerator(tree, { path: 'booking/state/src/booking-cache' })).rejects.toThrow('exists already');
  });
});
