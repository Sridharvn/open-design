import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'extraction',
    pathMatch: 'full',
  },
  {
    path: 'extraction',
    loadComponent: () =>
      import('./pages/extraction/extraction').then((m) => m.ExtractionPage),
    title: 'Extract · Angular UI',
  },
  {
    path: 'history',
    loadComponent: () =>
      import('./pages/history/history').then((m) => m.HistoryPage),
    title: 'History · Angular UI',
  },
  {
    path: '**',
    redirectTo: 'extraction',
  },
];
