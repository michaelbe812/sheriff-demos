import { describe, expect, it } from 'vitest';
import {
  hexagonalConfig,
  verticalSliceConfig,
} from '../src/presets';

describe('verticalSliceConfig', () => {
  it('blueprint has no infra bucket', () => {
    const cfg = verticalSliceConfig('blueprint');
    const keys = Object.keys(cfg.modules ?? {});
    expect(keys.some((k) => k.includes('/infra'))).toBe(false);
    expect(cfg.depRules).not.toHaveProperty('type:infra');
  });

  it('inverted adds infra bucket and lets the port declare its default impl', () => {
    const cfg = verticalSliceConfig('inverted');
    const keys = Object.keys(cfg.modules ?? {});
    expect(keys.some((k) => k.includes('/infra'))).toBe(true);
    expect(cfg.depRules).toHaveProperty('type:infra');
    // SELF-PROVIDING port: api MAY name infra to declare its default via
    // useFactory — layered, not inverted (see vertical-slice.ts).
    const apiRule = (cfg.depRules as Record<string, unknown>)['type:api'];
    expect(apiRule).toEqual([
      'type:types',
      'type:utils',
      'type:api',
      'type:infra',
    ]);
  });

  it('blueprint keeps type:api free of infra (no infra bucket exists)', () => {
    const cfg = verticalSliceConfig('blueprint');
    const apiRule = (cfg.depRules as Record<string, unknown>)['type:api'];
    expect(apiRule).toEqual(['type:types', 'type:utils', 'type:api']);
  });

  it('merges extra modules and dep rules', () => {
    const cfg = verticalSliceConfig('inverted', {
      extraModules: { 'libs/x/src': ['shared'] },
      extraDepRules: { custom: () => true },
    });
    expect(cfg.modules).toHaveProperty('libs/x/src');
    expect(cfg.depRules).toHaveProperty('custom');
  });
});

describe('hexagonalConfig', () => {
  // hexSlice modules are nested inside the `apps/<app>/src` module object
  const appModuleKeys = (cfg: ReturnType<typeof hexagonalConfig>): string[] => {
    const appMod = (cfg.modules ?? {})['apps/demo/src'];
    return appMod && typeof appMod === 'object' && !Array.isArray(appMod)
      ? Object.keys(appMod)
      : [];
  };

  it('fwcore has 3 layers, no application, no denyRules', () => {
    const cfg = hexagonalConfig('hexagonal-fwcore', {
      apps: { demo: ['booking'] },
    });
    const keys = appModuleKeys(cfg);
    expect(keys.some((k) => k.endsWith('/booking/domain'))).toBe(true);
    expect(keys.some((k) => k.endsWith('/application'))).toBe(false);
    expect(cfg.denyRules).toBeUndefined();
  });

  it('strict adds application layer and seals the core via denyRules', () => {
    const cfg = hexagonalConfig('hexagonal-strict', {
      apps: { demo: ['booking'] },
    });
    const keys = appModuleKeys(cfg);
    expect(keys.some((k) => k.endsWith('/booking/application'))).toBe(true);
    expect(cfg.denyRules).toBeDefined();
    const deny = cfg.denyRules?.['type:domain'];
    expect(deny?.({ from: 'type:domain', to: 'type:util' })).toBe(true);
    expect(deny?.({ from: 'type:domain', to: 'type:domain' })).toBe(false);
  });
});
