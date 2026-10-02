import { libFile, ruleTester } from '../testing/rule-tester';
import { layerSymbolNaming, RULE_NAME } from './layer-symbol-naming';

const component = (selector: string, className: string) =>
  `@Component({ selector: '${selector}', template: '' })\nexport class ${className} {}`;

ruleTester.run(RULE_NAME, layerSymbolNaming, {
  valid: [
    // stores, ports, feat containers, components — as in the example slices
    { code: 'export class BookingStore {}', filename: libFile('booking/state/src/booking.store.ts') },
    { code: 'export class BookingCardStore {}', filename: libFile('booking/ui/src/booking-card.store.ts') },
    { code: 'export class CheckinDeskStore {}', filename: libFile('checkin/feat-checkin/state/src/checkin-desk.store.ts') },
    { code: 'export class BookingApi {}', filename: libFile('booking/data-access/src/booking-api.ts') },
    { code: 'export interface PetSummary {}\nexport class PetApi {}', filename: libFile('shared/data-access/src/pet-api.ts') },
    { code: 'export class AuthStore {}', filename: libFile('shared/state/src/auth.store.ts') },
    { code: 'export class ApiHttp {}', filename: libFile('shared/data-access/src/http-client.ts') },
    { code: 'export class BookingNotifications {}', filename: libFile('booking/data-access/src/booking-notifications.ts') },
    { code: 'export function describeCheck() {}', filename: libFile('booking/utils/src/booking.utils.ts') },
    { code: component('app-feat-check-booking', 'FeatCheckBooking'), filename: libFile('booking/feat-check-booking/feature/src/feat-check-booking.ts') },
    { code: component('app-booking-card', 'BookingCard'), filename: libFile('booking/ui/src/booking-card.ts') },
    { code: component('app-layout-shell', 'LayoutShell'), filename: libFile('layout/shell/src/layout.shell.ts') },
    // prefix variant for generic names
    { code: component('app-button', 'AppButton'), filename: libFile('shared/ui/src/button.ts') },
    // a foreign prefix is @angular-eslint/component-selector's finding
    { code: component('foo-booking-card', 'BookingCard'), filename: libFile('booking/ui/src/booking-card.ts') },
    // selector prefix from the options
    {
      code: component('bk-booking-card', 'BookingCard'),
      filename: libFile('booking/ui/src/booking-card.ts'),
      options: [{ selectorPrefix: 'bk' }],
    },
    // shell
    { code: 'export const bookingRoutes = [];', filename: libFile('booking/shell/src/booking.routes.ts') },
    { code: 'export const carRentalRoutes = [];', filename: libFile('car-rental/shell/src/car-rental.routes.ts') },
    { code: 'export function provideBooking() { return []; }', filename: libFile('booking/shell/src/booking.providers.ts') },
    // testing
    {
      code: 'export function aBooking() {}\nexport const anOrder = () => ({});',
      filename: libFile('booking/testing/src/fixtures/booking.fixture.ts'),
    },
    {
      code: 'export const checkinsUrl = "/api";\nexport const defaultCheckinDtos = [];\nexport const checkinHandlers = [];\nexport const checkinScenarios = {};',
      filename: libFile('checkin/testing/src/handlers/checkin.handlers.ts'),
    },
    // specs, index.ts, generated code, apps: not checked
    { code: 'export class Whatever {}', filename: libFile('booking/state/src/booking.store.spec.ts') },
    { code: "export * from './booking.store';", filename: libFile('booking/state/src/index.ts') },
    { code: 'export class BookingService {}', filename: libFile('booking/generated/booking-client/api/src/generated/api/booking.store.ts') },
    { code: component('app-root', 'App'), filename: '/ws/apps/client/src/app/app.ts' },
  ],
  invalid: [
    {
      code: 'export class Bookings {}',
      filename: libFile('booking/state/src/booking.store.ts'),
      errors: [{ messageId: 'storeClass', data: { file: 'booking.store.ts', name: 'Bookings', expected: 'BookingStore' } }],
    },
    {
      code: 'export class BookingStore {}',
      filename: libFile('booking/state/src/booking-state.ts'),
      errors: [{ messageId: 'storeFile', data: { name: 'BookingStore', expected: 'booking.store.ts' } }],
    },
    {
      code: 'export class BookingPort {}',
      filename: libFile('booking/data-access/src/booking-api.ts'),
      errors: [{ messageId: 'apiClass', data: { file: 'booking-api.ts', name: 'BookingPort', expected: 'BookingApi' } }],
    },
    {
      code: 'export class BookingApi {}',
      filename: libFile('booking/data-access/src/bookings.ts'),
      errors: [{ messageId: 'apiFile', data: { name: 'BookingApi', expected: 'booking-api.ts' } }],
    },
    {
      code: component('app-feat-check-booking', 'CheckBookingContainer'),
      filename: libFile('booking/feat-check-booking/feature/src/feat-check-booking.ts'),
      errors: [
        {
          messageId: 'featClass',
          data: { file: 'feat-check-booking.ts', name: 'CheckBookingContainer', expected: 'FeatCheckBooking' },
        },
      ],
    },
    {
      code: component('app-feat-checking', 'FeatChecking'),
      filename: libFile('booking/feat-check-booking/feature/src/feat-checking.ts'),
      errors: [
        {
          messageId: 'featFile',
          data: { file: 'feat-checking.ts', lib: 'libs/booking/feat-check-booking/feature', expected: 'feat-check-booking.ts' },
        },
        { messageId: 'featClass', data: { file: 'feat-checking.ts', name: 'FeatChecking', expected: 'FeatCheckBooking' } },
      ],
    },
    {
      code: component('app-feat-x', 'FeatX'),
      filename: libFile('booking/ui/src/feat-x.ts'),
      errors: [{ messageId: 'featClassFile' }],
    },
    {
      code: component('app-booking-card', 'BookingCardComponent'),
      filename: libFile('booking/ui/src/booking-card.ts'),
      errors: [
        {
          messageId: 'componentClass',
          data: { file: 'booking-card.ts', name: 'BookingCardComponent', expected: 'BookingCard' },
          suggestions: [
            {
              messageId: 'renameClass',
              data: { expected: 'BookingCard' },
              output: component('app-booking-card', 'BookingCard'),
            },
          ],
        },
      ],
    },
    {
      code: component('app-card', 'BookingCard'),
      filename: libFile('booking/ui/src/booking-card.ts'),
      errors: [
        {
          messageId: 'componentSelector',
          data: { file: 'booking-card.ts', selector: 'app-card', expected: 'app-booking-card' },
          suggestions: [
            {
              messageId: 'renameSelector',
              data: { expected: 'app-booking-card' },
              output: component('app-booking-card', 'BookingCard'),
            },
          ],
        },
      ],
    },
    {
      code: 'export const routes = [];',
      filename: libFile('booking/shell/src/booking.routes.ts'),
      errors: [{ messageId: 'routesMissing', data: { file: 'booking.routes.ts', expected: 'bookingRoutes' } }],
    },
    {
      code: 'export const bookingsRoutes = [];',
      filename: libFile('booking/shell/src/booking.routes.ts'),
      errors: [{ messageId: 'routesExport', data: { lib: 'libs/booking/shell', name: 'bookingsRoutes', expected: 'bookingRoutes' } }],
    },
    {
      code: 'export const bookingRoutes = [];',
      filename: libFile('booking/shell/src/bookings.routes.ts'),
      errors: [{ messageId: 'sliceFile', data: { file: 'bookings.routes.ts', lib: 'libs/booking/shell', expected: 'booking.routes.ts' } }],
    },
    {
      code: 'export function bookingProviders() { return []; }',
      filename: libFile('booking/shell/src/booking.providers.ts'),
      errors: [{ messageId: 'providerName', data: { name: 'bookingProviders', expected: 'provideBooking' } }],
    },
    {
      code: 'export function createBooking() {}',
      filename: libFile('booking/testing/src/fixtures/booking.fixture.ts'),
      errors: [{ messageId: 'fixtureName', data: { name: 'createBooking' } }],
    },
    {
      code: 'export const handlers = [];\nexport const bookingsScenarios = {};',
      filename: libFile('booking/testing/src/handlers/booking.handlers.ts'),
      errors: [
        { messageId: 'handlersMissing', data: { file: 'booking.handlers.ts', expected: 'bookingHandlers' } },
        {
          messageId: 'handlersExport',
          data: { file: 'booking.handlers.ts', name: 'bookingsScenarios', expected: 'bookingScenarios' },
        },
      ],
    },
  ],
});
