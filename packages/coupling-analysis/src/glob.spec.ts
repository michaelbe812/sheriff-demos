import { describe, expect, it } from 'vitest';
import { globToRegExp, matchSlicePattern } from './glob.ts';

describe('globToRegExp', () => {
  it.each([
    ['**/node_modules/**', 'node_modules/a/b.ts', true],
    ['**/node_modules/**', 'libs/x/node_modules/a.ts', true],
    ['**/*.spec.*', 'libs/a/b.spec.ts', true],
    ['**/*.spec.*', 'b.spec.ts', true],
    ['**/*.spec.*', 'libs/a/spec.ts', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/a/b.ts', false],
  ])('%s matches %s → %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe('matchSlicePattern', () => {
  it('captures slice and folder', () => {
    expect(matchSlicePattern('libs/booking/state/src/a.ts', 'libs/{slice}/**')).toEqual({ slice: 'booking', folder: 'libs/booking/' });
  });

  it('supports wildcards before the slice', () => {
    expect(matchSlicePattern('apps/web/src/app/orders/a.ts', 'apps/*/src/app/{slice}/**')).toEqual({
      slice: 'orders',
      folder: 'apps/web/src/app/orders/',
    });
  });

  it('needs a file below the slice folder', () => {
    expect(matchSlicePattern('libs/booking.ts', 'libs/{slice}/**')).toBeUndefined();
    expect(matchSlicePattern('src/other/a.ts', 'libs/{slice}/**')).toBeUndefined();
  });

  it('rejects patterns without {slice}', () => {
    expect(() => matchSlicePattern('a.ts', 'libs/**')).toThrow('{slice}');
  });
});
