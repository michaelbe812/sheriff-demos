import { libFile, ruleTester } from '../testing/rule-tester';
import { libFileNaming, RULE_NAME } from './lib-file-naming';

const file = (path: string) => ({ code: 'export const x = 1;', filename: libFile(path) });
const invalid = (path: string, messageId: string, data?: Record<string, string>) => ({
  ...file(path),
  errors: [{ messageId: messageId as never, ...(data ? { data } : {}), line: 1, column: 1 }],
});

ruleTester.run(RULE_NAME, libFileNaming, {
  valid: [
    // every file of the example slices (booking/checkin/auth/layout/shared)
    file('booking/types/src/booking.model.ts'),
    file('checkin/types/src/checkin.dto.ts'),
    file('booking/utils/src/booking.utils.ts'),
    file('booking/events/src/booking.events.ts'),
    file('booking/api/src/booking-api.ts'),
    file('booking/api/src/booking-notifications.ts'),
    file('booking/api/src/booking-api.spec.ts'),
    file('booking/data/src/booking.store.ts'),
    file('booking/data/src/booking.store.spec.ts'),
    file('checkin/data/src/internal/checkin.mapper.ts'),
    file('booking/ui/src/booking-card.ts'),
    file('booking/ui/src/booking-card.store.ts'),
    file('booking/feat-check-booking/feature/src/feat-check-booking.ts'),
    file('booking/feat-check-booking/data/src/check-booking.store.ts'),
    file('booking/shell/src/booking.routes.ts'),
    file('auth/shell/src/auth.providers.ts'),
    file('layout/shell/src/layout.shell.ts'),
    file('booking/shell/src/booking-page.ts'),
    file('booking/testing/src/fixtures/booking.fixture.ts'),
    file('booking/testing/src/handlers/booking.handlers.ts'),
    file('shared/testing/src/network.ts'),
    // shared buckets: plain helper files also in types/utils
    file('shared/utils/src/format-date.ts'),
    file('shared/types/src/entity-id.ts'),
    // public API, generated code, generated client libs, outside libs: not this rule's business
    file('booking/types/src/index.ts'),
    file('booking/generated/booking-client/api/src/generated/api/Booking_Service.ts'),
    file('generated/pet-client/types/src/index.ts'),
    file('booking/types/src/generated/Whatever.ts'),
    { code: 'export const x = 1;', filename: '/ws/apps/client/src/app/app.routes.ts' },
    { code: 'export const x = 1;', filename: '/ws/packages/tooling/conventions/src/lib-conventions.ts' },
  ],
  invalid: [
    invalid('booking/utils/src/booking.store.ts', 'kindLayer', {
      file: 'booking.store.ts',
      kind: 'store',
      layer: 'utils',
      lib: 'libs/booking/utils',
      layers: 'data/ui/feature',
    }),
    invalid('booking/ui/src/booking.routes.ts', 'kindLayer'),
    invalid('checkin/feat-checkin/data/src/desk.model.ts', 'kindLayer'),
    invalid('booking/types/src/booking.ts', 'plainFile', {
      file: 'booking.ts',
      layer: 'types',
      lib: 'libs/booking/types',
      expected: 'booking.model.ts | booking.dto.ts',
    }),
    invalid('booking/utils/src/format.ts', 'plainFile'),
    invalid('booking/events/src/booking-confirmed.ts', 'plainFile'),
    invalid('booking/data/src/booking.service.ts', 'unknownKind', {
      file: 'booking.service.ts',
      kind: 'service',
      layer: 'data',
      allowed: 'booking.ts | booking.mapper.ts | booking.store.ts',
    }),
    invalid('booking/ui/src/booking-card.component.ts', 'unknownKind'),
    invalid('booking/ui/src/BookingCard.ts', 'fileCase', { file: 'BookingCard.ts', name: 'BookingCard' }),
    invalid('booking/ui/src/booking_card.ts', 'fileCase'),
    invalid('booking/ui/src/Cards/booking-card.ts', 'folderCase', { folder: 'Cards' }),
    invalid('booking/testing/src/booking.fixture.ts', 'kindFolder', { file: 'booking.fixture.ts', folder: 'fixtures' }),
    invalid('booking/testing/src/fixtures/booking.handlers.ts', 'kindFolder'),
    // specs are named like the file they test
    invalid('booking/utils/src/booking.store.spec.ts', 'kindLayer'),
  ],
});
