import { createSheriffConfig } from '@berger-engineering/sheriff-blueprint';

/**
 * Rules, slice shape and rationale live in the shared blueprint package
 * (packages/sheriff-blueprint) — see docs/architecture.md. Projects only
 * declare their shared features and entry points here.
 */
export const config = createSheriffConfig({
  sharedFeatures: ['auth', 'layout'],
  entryPoints: {
    client: 'apps/client/src/main.ts',
    // CLI cross-check per extracted lib (ESLint is the authoritative gate):
    'domain-booking': 'libs/domains/booking/src/booking.routes.ts',
  },
});
