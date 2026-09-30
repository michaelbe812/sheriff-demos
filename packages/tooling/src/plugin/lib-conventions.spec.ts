import { describe, expect, it } from 'vitest';
import { deriveTags, libPathError, parseLibPath } from './lib-conventions';

const scopes = ['auth', 'booking', 'checkin', 'layout', 'shared'];

describe('deriveTags', () => {
  it('derives scope/type/feat + markers from the path', () => {
    expect(deriveTags('booking/api', { scopes })).toEqual(['scope:booking', 'type:api', 'feat:none', 'port']);
    expect(deriveTags('booking/shell', { scopes })).toEqual(['scope:booking', 'type:feature', 'feat:none', 'entry']);
    expect(deriveTags('booking/feat-check-booking/api', { scopes })).toEqual([
      'scope:booking',
      'type:api',
      'feat:check-booking',
      'feat-port',
    ]);
    expect(deriveTags('shared/api', { scopes })).toEqual(['scope:shared', 'type:api', 'feat:none']);
    expect(deriveTags('booking/testing', { scopes })).toEqual(['scope:booking', 'type:testing', 'feat:none']);
  });

  it('rejects an unknown layer or a wrong shape', () => {
    expect(() => deriveTags('booking/widgets')).toThrow('not a blueprint lib path');
    expect(() => deriveTags('booking/feat-x/y/ui')).toThrow('not a blueprint lib path');
    expect(parseLibPath('booking')).toBeUndefined();
  });

  it('rejects a scope outside the scope list with a typo hint', () => {
    expect(() => deriveTags('bokking/ui', { scopes })).toThrow('unknown scope "bokking" (did you mean "booking"?)');
    expect(libPathError('payment/ui', { scopes })).toContain('nx g @blueprint/tooling:domain payment');
  });

  it('accepts every scope without a list (backwards compatible)', () => {
    expect(deriveTags('anything/ui')).toContain('scope:anything');
  });
});
