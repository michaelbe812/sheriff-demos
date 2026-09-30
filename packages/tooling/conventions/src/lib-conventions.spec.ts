import { describe, expect, it } from 'vitest';
import { deriveTags, libPathError, parseClientPath, parseLibPath, scopesOfFile } from './lib-conventions';

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
    expect(libPathError('payment/ui', { scopes })).toContain('nx g @blueprint/tooling-workspace:domain payment');
  });

  it('accepts every scope without a list (backwards compatible)', () => {
    expect(deriveTags('anything/ui')).toContain('scope:anything');
  });

  it('reads the scope list of lib-scopes.json', () => {
    expect(scopesOfFile({ scopes })).toEqual(scopes);
    expect(scopesOfFile({})).toBeUndefined();
    expect(scopesOfFile(undefined)).toBeUndefined();
    expect(libPathError('payment/ui', { scopes })).toContain('Allowed scopes (lib-scopes.json)');
  });
});

describe('generated OpenAPI clients', () => {
  it('derives scope from the placement, type from the part, marker `generated`, never port', () => {
    expect(deriveTags('generated/pet-client/api', { scopes })).toEqual([
      'scope:shared',
      'type:api',
      'feat:none',
      'generated',
    ]);
    expect(deriveTags('generated/pet-client/core', { scopes })).toEqual([
      'scope:shared',
      'type:api',
      'feat:none',
      'generated',
    ]);
    expect(deriveTags('booking/generated/booking-client/types', { scopes })).toEqual([
      'scope:booking',
      'type:types',
      'feat:none',
      'generated',
    ]);
    expect(deriveTags('booking/generated/booking-client/testing', { scopes })).toEqual([
      'scope:booking',
      'type:testing',
      'feat:none',
      'generated',
    ]);
    expect(parseLibPath('booking/generated/booking-client/api')?.client).toEqual({
      path: 'booking/generated/booking-client',
      name: 'booking-client',
      part: 'api',
    });
  });

  it('`generated` is reserved: wrong shapes and unknown parts fail with a hint', () => {
    expect(() => deriveTags('generated/pet-client/ui', { scopes })).toThrow('not a generated client lib');
    expect(() => deriveTags('generated/api', { scopes })).toThrow('not a generated client lib');
    expect(() => deriveTags('booking/feat-x/generated/c/api', { scopes })).toThrow('not a generated client lib');
    expect(() => deriveTags('payment/generated/c/api', { scopes })).toThrow('unknown scope "payment"');
  });

  it('parses client paths', () => {
    expect(parseClientPath('generated/pet-client')).toEqual({
      path: 'generated/pet-client',
      name: 'pet-client',
      scope: 'shared',
      placement: 'shared',
    });
    expect(parseClientPath('booking/generated/booking-client')?.placement).toEqual({ domain: 'booking' });
    expect(parseClientPath('booking/generated')).toBeUndefined();
    expect(parseClientPath('generated/generated/x')).toBeUndefined();
  });
});
