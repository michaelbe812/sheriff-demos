/**
 * Fixture workspace for the generator specs: the relevant slice of the real blueprint
 * (scope list, app routes with a lazy booking shell, booking slice, shared api/testing).
 */
import { type Tree, updateNxJson, readNxJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { WORKSPACE_PLUGIN } from '../lib-conventions';

export const APP_ROUTES = 'apps/client/src/app/app.routes.ts';

const appRoutes = `import { Route } from '@angular/router';
import { LayoutShell } from '@blueprint/layout/shell';

export const appRoutes: Route[] = [
  {
    path: '',
    component: LayoutShell,
    children: [
      {
        path: 'bookings',
        loadChildren: () => import('@blueprint/booking/shell').then((m) => m.bookingRoutes),
      },
      { path: '', pathMatch: 'full', redirectTo: 'bookings' },
    ],
  },
];
`;

const bookingRoutes = `import { Routes } from '@angular/router';

export const bookingRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('@blueprint/booking/feat-check-booking/feature').then((m) => m.FeatCheckBooking),
  },
];
`;

const files: Record<string, string> = {
  [APP_ROUTES]: appRoutes,
  'libs/booking/shell/src/index.ts': "export * from './booking.routes';\n",
  'libs/booking/shell/src/booking.routes.ts': bookingRoutes,
  'libs/booking/types/src/index.ts': "export * from './booking.model';\n",
  'libs/booking/types/src/booking.model.ts': 'export interface Booking {\n  id: string;\n}\n',
  'libs/booking/api/src/index.ts': "export * from './booking-api';\n",
  'libs/booking/api/src/booking-api.ts': "export type { Booking } from '@blueprint/booking/types';\nexport class BookingApi {}\n",
  'libs/booking/state/src/index.ts': "export * from './booking.store';\n",
  'libs/booking/state/src/booking.store.ts': "import { BookingApi } from '@blueprint/booking/api';\nexport class BookingStore {\n  api = BookingApi;\n}\n",
  'libs/booking/feat-check-booking/feature/src/index.ts': "export * from './feat-check-booking';\n",
  'libs/booking/feat-check-booking/feature/src/feat-check-booking.ts':
    "import { BookingStore } from '@blueprint/booking/state';\nexport class FeatCheckBooking {\n  store = BookingStore;\n}\n",
  'libs/layout/shell/src/index.ts': 'export class LayoutShell {}\n',
  'libs/shared/api/src/index.ts': 'export class ApiHttp {}\n',
  'libs/shared/testing/src/index.ts': 'export const worker = {};\n',
  'libs/tsconfig.json': '{}\n',
};

export function createBlueprintTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  const nxJson = readNxJson(tree) ?? {};
  updateNxJson(tree, {
    ...nxJson,
    plugins: [{ plugin: WORKSPACE_PLUGIN, options: { scopes: ['booking', 'layout', 'shared'] } }],
  });
  for (const [path, content] of Object.entries(files)) tree.write(path, content);
  return tree;
}

export const read = (tree: Tree, path: string): string => tree.read(path, 'utf-8') ?? '';

export function scopesOf(tree: Tree): string[] | undefined {
  const entry = readNxJson(tree)?.plugins?.[0];
  return typeof entry === 'object' ? (entry.options as { scopes?: string[] }).scopes : undefined;
}
