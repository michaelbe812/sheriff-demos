import { Routes } from '@angular/router';

/** Slice root (type:shell): feats are lazy-loaded, one lib each. */
export const checkinRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('@blueprint/checkin/feat-checkin/feature').then((m) => m.FeatCheckin),
  },
  {
    path: 'history',
    loadComponent: () => import('@blueprint/checkin/feat-history/feature').then((m) => m.FeatHistory),
  },
];
