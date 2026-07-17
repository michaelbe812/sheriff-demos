import { Routes } from '@angular/router';

const checkinRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./feat-checkin/feat-checkin').then((m) => m.FeatCheckin),
  },
  {
    path: 'history',
    loadComponent: () => import('./feat-history/feat-history').then((m) => m.FeatHistory),
  },
];

export default checkinRoutes;
