import { describe, expect, it } from 'vitest';
import {
  appOf,
  sameApp,
  verticalSliceConfig,
} from '../src/presets';
import { DepRule, DepRuleContext } from '../src/presets/sheriff-types';

const ctx = (
  from: string,
  to: string,
  overrides: Partial<DepRuleContext> = {},
): DepRuleContext => ({
  from,
  to,
  fromModulePath: 'apps/client/src/app/domains/booking/data',
  toModulePath: 'apps/client/src/app/domains/booking/api',
  fromFilePath: 'apps/client/src/app/domains/booking/data/booking.store.ts',
  toFilePath: 'apps/client/src/app/domains/booking/api/index.ts',
  ...overrides,
});

const allows = (rule: DepRule, context: DepRuleContext): boolean => {
  if (Array.isArray(rule)) {
    return rule.some((part) => allows(part, context));
  }
  if (typeof rule === 'string') {
    return rule === context.to;
  }
  return rule(context);
};

const invertedRules = verticalSliceConfig('inverted').depRules!;

describe('verticalSliceConfig dep rule predicates', () => {
  it('allows type:api -> type:infra in the inverted preset (self-providing port)', () => {
    // The port declares its own default impl via useFactory, so it must be
    // able to name it. Everyone else (data/ui/feat, foreign domains) stays
    // blocked — see the tests below.
    expect(
      allows(
        invertedRules['type:api'],
        ctx('type:api', 'type:infra', {
          fromModulePath: 'apps/client/src/app/domains/booking/api',
          toModulePath: 'apps/client/src/app/domains/booking/infra',
          fromFilePath: 'apps/client/src/app/domains/booking/api/index.ts',
          toFilePath:
            'apps/client/src/app/domains/booking/infra/http-booking-api.ts',
        }),
      ),
    ).toBe(true);
  });

  it('allows slice roots, but not feat roots, to wire type:infra', () => {
    expect(
      allows(
        invertedRules['type:feature'],
        ctx('type:feature', 'type:infra', {
          fromModulePath: 'apps/client/src/app/domains/booking',
          toModulePath: 'apps/client/src/app/domains/booking/infra',
          fromFilePath:
            'apps/client/src/app/domains/booking/booking.providers.ts',
        }),
      ),
    ).toBe(true);

    expect(
      allows(
        invertedRules['type:feature'],
        ctx('type:feature', 'type:infra', {
          fromModulePath: 'apps/client/src/app/domains/booking/feat-check-in',
          toModulePath: 'apps/client/src/app/domains/booking/infra',
          fromFilePath:
            'apps/client/src/app/domains/booking/feat-check-in/feat-check-in.ts',
        }),
      ),
    ).toBe(false);
  });

  it('allows same-domain dependencies and blocks cross-domain direct imports', () => {
    expect(
      allows(
        invertedRules['domain:*'],
        ctx('domain:booking', 'domain:booking'),
      ),
    ).toBe(true);

    expect(
      allows(
        invertedRules['domain:*'],
        ctx('domain:booking', 'domain:billing', {
          toModulePath: 'apps/client/src/app/domains/billing/data',
          toFilePath:
            'apps/client/src/app/domains/billing/data/billing.store.ts',
        }),
      ),
    ).toBe(false);
  });

  it('allows cross-domain access through a port marker', () => {
    expect(
      allows(
        invertedRules['domain:*'],
        ctx('domain:booking', 'port', {
          toModulePath: 'apps/client/src/app/domains/billing/api',
          toFilePath: 'apps/client/src/app/domains/billing/api/index.ts',
        }),
      ),
    ).toBe(true);
  });

  it('keeps app-scoped imports inside the same app', () => {
    expect(appOf('apps/client/src/app/domains/booking/data/x.ts')).toBe(
      'client',
    );
    expect(
      sameApp(
        ctx('app:client', 'entry', {
          fromFilePath: 'apps/client/src/main.ts',
          toModulePath: 'apps/client/src/app/domains/booking',
        }),
      ),
    ).toBe(true);
    expect(
      sameApp(
        ctx('app:client', 'entry', {
          fromFilePath: 'apps/admin/src/main.ts',
          toModulePath: 'apps/client/src/app/domains/booking',
        }),
      ),
    ).toBe(false);
  });
});
