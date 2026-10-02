/**
 * Fixture workspace for the generator specs: the relevant slice of the real blueprint
 * (scope list, app routes with a lazy booking shell, booking slice, shared api/testing), every lib
 * with its explicit config files + paths entry, as the generators write them.
 */
import type { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { SCOPES_FILE } from '../lib-conventions';
import { listLibPaths, readJsonFile, readScopes, writeJsonFile, writeLibConfig } from '../tree';

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
  'libs/booking/api/src/booking-api.ts':
    "export type { Booking } from '@blueprint/booking/types';\nexport class BookingApi {}\n",
  'libs/booking/state/src/index.ts': "export * from './booking.store';\n",
  'libs/booking/state/src/booking.store.ts':
    "import { BookingApi } from '@blueprint/booking/api';\nexport class BookingStore {\n  api = BookingApi;\n}\n",
  'libs/booking/feat-check-booking/feature/src/index.ts': "export * from './feat-check-booking';\n",
  'libs/booking/feat-check-booking/feature/src/feat-check-booking.ts':
    "import { BookingStore } from '@blueprint/booking/state';\nexport class FeatCheckBooking {\n  store = BookingStore;\n}\n",
  'libs/layout/shell/src/index.ts': 'export class LayoutShell {}\n',
  'libs/shared/api/src/index.ts': 'export class ApiHttp {}\n',
  'libs/shared/testing/src/index.ts': 'export const worker = {};\n',
};

export function createBlueprintTree(): Tree {
  const tree = createTreeWithEmptyWorkspace();
  writeJsonFile(tree, SCOPES_FILE, { scopes: ['booking', 'layout', 'shared'] });
  writeJsonFile(tree, 'tsconfig.base.json', { compilerOptions: { paths: {} } });
  // versions for the peerDependencies the generators derive from the imports
  writeJsonFile(tree, 'package.json', {
    name: 'fixture',
    dependencies: { '@angular/core': '~22.0.4', '@angular/router': '~22.0.4', rxjs: '~7.8.0' },
    devDependencies: { msw: '^3.0.0', vitest: '~4.1.11' },
  });
  for (const [path, content] of Object.entries(files)) tree.write(path, content);
  for (const libPath of listLibPaths(tree)) writeLibConfig(tree, libPath);
  return tree;
}

export const read = (tree: Tree, path: string): string => tree.read(path, 'utf-8') ?? '';

export const scopesOf = (tree: Tree): string[] | undefined => readScopes(tree);

/** project.json as the specs read it. */
export interface ProjectJson {
  name?: string;
  tags?: string[];
  implicitDependencies?: string[];
  targets: Record<
    string,
    { executor?: string; options?: Record<string, unknown>; inputs?: unknown[]; dependsOn?: string[] }
  >;
}

export const readProject = (tree: Tree, path: string): ProjectJson => readJsonFile<ProjectJson>(tree, path);

/** tsconfig.base.json `paths`. */
export const pathsOf = (tree: Tree): Record<string, string[]> =>
  readJsonFile<{ compilerOptions: { paths: Record<string, string[]> } }>(tree, 'tsconfig.base.json').compilerOptions
    .paths;
