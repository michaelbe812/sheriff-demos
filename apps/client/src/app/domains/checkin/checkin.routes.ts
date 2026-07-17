import { Routes } from '@angular/router';

const checkinRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./feat-checkin/feat-checkin').then((m) => m.FeatCheckin),
  },
];

export default checkinRoutes;
