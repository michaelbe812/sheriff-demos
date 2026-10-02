import { describe, expect, it } from 'vitest';
import {
  appOf,
  createSheriffConfig,
  inAnyFeat,
  nxModuleBoundariesOptions,
  sameApp,
} from '../src';

type RuleFn = (ctx: {
  from: string;
  to: string;
  fromModulePath: string;
  toModulePath: string;
  fromFilePath: string;
  toFilePath: string;
}) => boolean;

const ctx = (partial: Partial<Parameters<RuleFn>[0]>): Parameters<RuleFn>[0] => ({
  from: '',
  to: '',
  fromModulePath: '',
  toModulePath: '',
  fromFilePath: '',
  toFilePath: '',
  ...partial,
});

const rules = createSheriffConfig({ sharedFeatures: ['auth', 'layout'] })
  .depRules as Record<string, unknown>;

const fnsOf = (tag: string): RuleFn[] => {
  const value = rules[tag];
  const matchers = Array.isArray(value) ? value : [value];
  return matchers.filter((m): m is RuleFn => typeof m === 'function');
};

const anyFnAllows = (tag: string, c: Parameters<RuleFn>[0]): boolean =>
  fnsOf(tag).some((fn) => fn(c));

describe('sameApp / path helpers', () => {
  it('extracts the app name', () => {
    expect(appOf('/w/apps/client/src/app/domains/x')).toBe('client');
    expect(appOf('/w/libs/domains/booking/src/api')).toBeNull();
  });

  it('allows same app, blocks foreign app, allows libs, blocks lib->app', () => {
    const client = '/w/apps/client/src/app/x.ts';
    expect(sameApp({ fromFilePath: client, toModulePath: '/w/apps/client/src/app/shared/ui' })).toBe(true);
    expect(sameApp({ fromFilePath: client, toModulePath: '/w/apps/admin/src/app/shared/ui' })).toBe(false);
    expect(sameApp({ fromFilePath: client, toModulePath: '/w/libs/domains/booking/src/api' })).toBe(true);
    expect(sameApp({ fromFilePath: '/w/libs/domains/booking/src/state/s.ts', toModulePath: '/w/apps/client/src/app/shared/ui' })).toBe(false);
  });

  it('root module files (workspace root) still pass sameApp via file path', () => {
    expect(sameApp({ fromFilePath: '/w/apps/client/src/main.ts', toModulePath: '/w/apps/client/src/app' })).toBe(true);
  });

  it('detects feat folders', () => {
    expect(inAnyFeat('/w/libs/domains/b/src/feat-check/state')).toBe(true);
    expect(inAnyFeat('/w/libs/domains/b/src/state')).toBe(false);
    expect(inAnyFeat('/w/apps/c/src/app/domains/d/feat-x')).toBe(true);
  });
});

describe('domain axis', () => {
  it('allows the own domain, blocks foreign domain internals', () => {
    const base = { fromFilePath: '/w/apps/c/src/app/domains/checkin/state/s.ts' };
    expect(anyFnAllows('domain:*', ctx({ ...base, from: 'domain:checkin', to: 'domain:checkin', toModulePath: '/w/apps/c/src/app/domains/checkin/ui' }))).toBe(true);
    expect(anyFnAllows('domain:*', ctx({ ...base, from: 'domain:checkin', to: 'domain:booking', toModulePath: '/w/libs/domains/booking/src/state' }))).toBe(false);
  });

  it('allows foreign domains only via port, and shared', () => {
    const base = { fromFilePath: '/w/apps/c/src/app/domains/checkin/state/s.ts' };
    expect(anyFnAllows('domain:*', ctx({ ...base, from: 'domain:checkin', to: 'port', toModulePath: '/w/libs/domains/booking/src/api' }))).toBe(true);
    expect(anyFnAllows('domain:*', ctx({ ...base, from: 'domain:checkin', to: 'shared', toModulePath: '/w/apps/c/src/app/shared/ui' }))).toBe(true);
  });

  it('blocks ports of another app', () => {
    expect(
      anyFnAllows('domain:*', ctx({
        from: 'domain:checkin',
        to: 'port',
        fromFilePath: '/w/apps/client/src/app/domains/checkin/state/s.ts',
        toModulePath: '/w/apps/admin/src/app/domains/billing/api',
      })),
    ).toBe(false);
  });
});

describe('feat axis', () => {
  it('allows targets outside any feat folder', () => {
    expect(anyFnAllows('feat:*', ctx({ from: 'feat:history', to: 'domain:checkin', toModulePath: '/w/apps/c/src/app/domains/checkin/state' }))).toBe(true);
  });

  it('blocks sibling feat internals, allows sibling feat-port', () => {
    const toModulePath = '/w/apps/c/src/app/domains/checkin/feat-checkin/state';
    expect(anyFnAllows('feat:*', ctx({ from: 'feat:history', to: 'domain:checkin', toModulePath }))).toBe(false);
    expect(anyFnAllows('feat:*', ctx({ from: 'feat:history', to: 'feat-port', toModulePath: '/w/apps/c/src/app/domains/checkin/feat-checkin/api' }))).toBe(true);
  });
});

describe('type axis + marker tags', () => {
  it('keeps ui away from api and state', () => {
    expect(rules['type:ui']).toEqual(['type:types', 'type:utils', 'type:ui', 'type:events']);
  });

  it('marker tags are transparent as from tags', () => {
    for (const tag of ['entry', 'port', 'feat-port']) {
      expect(anyFnAllows(tag, ctx({ to: 'type:types' }))).toBe(true);
    }
  });

  it('has no wildcard catch-all that would bypass the layer matrix', () => {
    expect(rules['*']).toBeUndefined();
    expect(rules['noTag']).toEqual([]);
  });
});

describe('createSheriffConfig options', () => {
  it('generates app and lib slices for each shared feature', () => {
    const config = createSheriffConfig({ sharedFeatures: ['auth'] });
    const appModules = (config.modules as Record<string, unknown>)['apps/<app>/src'] as Record<string, unknown>;
    expect(appModules['app/auth']).toEqual(['domain:auth', 'type:feature', 'entry']);
    expect(appModules['app/auth/api']).toEqual(['domain:auth', 'type:api', 'port']);
    expect((config.modules as Record<string, unknown>)['libs/auth/src']).toBeDefined();
  });

  it('merges extraModules and extraDepRules', () => {
    const config = createSheriffConfig({
      extraModules: { tools: ['shared'] },
      extraDepRules: { 'type:ui': ['type:types'] },
    });
    expect((config.modules as Record<string, unknown>)['tools']).toEqual(['shared']);
    expect((config.depRules as Record<string, unknown>)['type:ui']).toEqual(['type:types']);
  });

  it('passes entryPoints through', () => {
    expect(createSheriffConfig({ entryPoints: { a: 'apps/a/src/main.ts' } }).entryPoints).toEqual({ a: 'apps/a/src/main.ts' });
    expect(createSheriffConfig({}).entryPoints).toBeUndefined();
  });
});

describe('nx boundary options', () => {
  it('excludes blueprint aliases from the dynamic dependency check', () => {
    expect(nxModuleBoundariesOptions('@acme').checkDynamicDependenciesExceptions).toEqual(['@acme/**']);
  });
});
