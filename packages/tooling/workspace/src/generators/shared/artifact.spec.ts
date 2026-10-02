import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBlueprintTree, read } from '@blueprint/tooling-conventions/testing';
import { writeLibConfig } from '@blueprint/tooling-conventions/tree';
import { componentGenerator } from '../component/generator';
import { serviceGenerator } from '../service/generator';
import { storeGenerator } from '../store/generator';

describe('component / service / store wrappers', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createBlueprintTree();
    tree.write('libs/booking/ui/src/index.ts', 'export {};\n');
    writeLibConfig(tree, 'booking/ui');
  });

  it('component: @nx/angular:component (finds the lib by its project.json), inline, exported from index.ts', async () => {
    await componentGenerator(tree, { path: 'libs/booking/ui/src/badges/booking-badge', skipFormat: true });

    const component = read(tree, 'libs/booking/ui/src/badges/booking-badge.ts');
    expect(component).toContain("selector: 'app-booking-badge'");
    expect(component).toContain('template: `');
    expect(component).toContain('export class BookingBadge');
    expect(tree.exists('libs/booking/ui/src/badges/booking-badge.spec.ts')).toBe(false);
    expect(read(tree, 'libs/booking/ui/src/index.ts')).toContain("export * from './badges/booking-badge';");
    await expect(componentGenerator(tree, { path: 'libs/booking/ui/src/badges/booking-badge' })).rejects.toThrow(
      'exists already',
    );
  });

  it('service: @schematics/angular:service (project from the path), path without src/ works too', async () => {
    await serviceGenerator(tree, { path: 'booking/state/booking-cache', export: false, skipFormat: true });

    expect(read(tree, 'libs/booking/state/src/booking-cache.ts')).toContain('export class BookingCache');
    // Angular 22 default: @Service() (root-provided)
    expect(read(tree, 'libs/booking/state/src/booking-cache.ts')).toContain('@Service()');
    expect(tree.exists('libs/booking/state/src/booking-cache.spec.ts')).toBe(false);
    expect(read(tree, 'libs/booking/state/src/index.ts')).toBe("export * from './booking.store';\n");

    await serviceGenerator(tree, { path: 'libs/booking/api/src/cache/api-cache', skipFormat: true });
    expect(read(tree, 'libs/booking/api/src/cache/api-cache.ts')).toContain('export class ApiCache');
    expect(read(tree, 'libs/booking/api/src/index.ts')).toContain("export * from './cache/api-cache';");
    await expect(serviceGenerator(tree, { path: 'libs/booking/api/src/cache/api-cache' })).rejects.toThrow(
      'exists already',
    );
  });

  it('store: <name>.store.ts with <Name>Store', async () => {
    await storeGenerator(tree, { path: 'libs/booking/ui/src/booking-filter' });

    expect(read(tree, 'libs/booking/ui/src/booking-filter.store.ts')).toContain('export class BookingFilterStore');
    expect(read(tree, 'libs/booking/ui/src/index.ts')).toBe("export * from './booking-filter.store';\n");
  });

  it('validates lib, layer and existing files', async () => {
    await expect(componentGenerator(tree, { path: 'libs/booking/state/src/card' })).rejects.toThrow(
      'ui/feature/shell lib',
    );
    await expect(componentGenerator(tree, { path: 'libs/nope/ui/src/card' })).rejects.toThrow('is no lib');
    await storeGenerator(tree, { path: 'booking/state/src/booking-cache' });
    await expect(storeGenerator(tree, { path: 'booking/state/src/booking-cache' })).rejects.toThrow('exists already');
  });
});
