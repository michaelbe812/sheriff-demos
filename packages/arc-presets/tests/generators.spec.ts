import { Tree, readJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import initGenerator from '../src/generators/init/generator';
import domainGenerator from '../src/generators/domain/generator';
import hexagonGenerator from '../src/generators/hexagon/generator';
import doctorGenerator from '../src/generators/doctor/generator';
import migrateGenerator from '../src/generators/migrate/generator';

describe('init generator', () => {
  let tree: Tree;
  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('scaffolds inverted config, deps and verify script', async () => {
    await initGenerator(tree, { preset: 'inverted', app: 'client' });
    const cfg = tree.read('sheriff.config.ts', 'utf-8') ?? '';
    expect(cfg).toContain("arc-presets:preset=inverted");
    expect(cfg).toContain("verticalSliceConfig('inverted'");

    const pkg = readJson(tree, 'package.json');
    expect(pkg.devDependencies).toHaveProperty(
      '@lambda-solutions/sheriff-core',
    );
    expect(pkg.scripts['sheriff:verify']).toBe('sheriff verify');
  });

  it('uses upstream when installFork=false', async () => {
    await initGenerator(tree, { preset: 'blueprint', installFork: false });
    const pkg = readJson(tree, 'package.json');
    expect(pkg.devDependencies).toHaveProperty('@softarc/sheriff-core');
    expect(pkg.devDependencies).not.toHaveProperty(
      '@lambda-solutions/sheriff-core',
    );
  });

  it('rejects strict preset without the fork', async () => {
    await expect(
      initGenerator(tree, {
        preset: 'hexagonal-strict',
        installFork: false,
      }),
    ).rejects.toThrow(/requires the @lambda-solutions/);
  });
});

describe('domain generator', () => {
  it('inverted domain writes infra and a self-providing port, no providers file', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'inverted', app: 'client' });
    await domainGenerator(tree, { name: 'booking', app: 'client' });
    const base = 'apps/client/src/app/domains/booking';
    expect(tree.exists(`${base}/api/index.ts`)).toBe(true);
    expect(tree.exists(`${base}/infra/http-booking-api.ts`)).toBe(true);
    // the port declares its own default impl, so no wiring file is scaffolded
    expect(tree.exists(`${base}/booking.providers.ts`)).toBe(false);
    const port = tree.read(`${base}/api/index.ts`, 'utf-8')!;
    expect(port).toContain('useFactory');
    expect(port).toContain('inject(HttpBookingApi)');
    expect(tree.read(`${base}/infra/http-booking-api.ts`, 'utf-8')).toContain(
      'implements BookingApi',
    );
  });

  it('blueprint domain has no infra', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'blueprint', app: 'client' });
    await domainGenerator(tree, { name: 'booking', app: 'client' });
    const base = 'apps/client/src/app/domains/booking';
    expect(tree.exists(`${base}/api/booking-api.ts`)).toBe(true);
    expect(tree.exists(`${base}/infra/http-booking-api.ts`)).toBe(false);
  });

  it('rejects on a hexagonal preset', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'hexagonal-fwcore', app: 'client' });
    await expect(
      domainGenerator(tree, { name: 'booking', app: 'client' }),
    ).rejects.toThrow(/hexagon/);
  });
});

describe('hexagon generator', () => {
  it('fwcore writes domain store, no application', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'hexagonal-fwcore', app: 'client' });
    await hexagonGenerator(tree, { name: 'booking', app: 'client' });
    const base = 'apps/client/src/app/domains/booking';
    expect(tree.exists(`${base}/domain/booking.store.ts`)).toBe(true);
    expect(tree.exists(`${base}/application/booking.store.ts`)).toBe(false);
    expect(tree.exists(`${base}/ports/in/booking.facade.ts`)).toBe(true);
    expect(tree.exists(`${base}/adapters/driven/http-booking.repository.ts`)).toBe(true);
  });

  it('strict writes application store', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'hexagonal-strict', app: 'client' });
    await hexagonGenerator(tree, { name: 'booking', app: 'client' });
    const base = 'apps/client/src/app/domains/booking';
    expect(tree.exists(`${base}/application/booking.store.ts`)).toBe(true);
  });
});

describe('migrate generator', () => {
  it('flips blueprint config to inverted', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'blueprint', app: 'client' });
    await migrateGenerator(tree, {});
    const cfg = tree.read('sheriff.config.ts', 'utf-8') ?? '';
    expect(cfg).toContain("verticalSliceConfig('inverted'");
    expect(cfg).toContain('arc-presets:preset=inverted');
  });
});

describe('doctor generator', () => {
  it('runs without throwing on a scaffolded workspace', async () => {
    const tree = createTreeWithEmptyWorkspace();
    await initGenerator(tree, { preset: 'inverted', app: 'client' });
    await expect(doctorGenerator(tree, {})).resolves.toBeUndefined();
  });
});
