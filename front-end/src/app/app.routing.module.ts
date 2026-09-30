import { inject, NgModule } from '@angular/core';
import { PreloadAllModules, Router, RouterModule, Routes } from '@angular/router';
import { initGuard } from './init.guard';
import { authGuard } from './auth.guard';

const routes: Routes = [
  {
    path: 'auth',
    canActivate: [initGuard],
    loadChildren: () => import('./auth/auth.module').then((m) => m.AuthPageModule)
  },
  {
    path: 't',
    canActivate: [initGuard, authGuard],
    loadChildren: () => import('./tabs/tabs.module').then((m) => m.TabsModule)
  },
  {
    path: 'home',
    redirectTo: 't/home',
    pathMatch: 'full'
  },
  {
    path: '',
    redirectTo: 't/home',
    pathMatch: 'full'
  },
  {
    path: '**',
    canActivate: [
      (_route, state) => {
        const router = inject(Router);
        const url = state?.url || '';
        const clean = url.replace(/^\/+/, '');
        const firstSegment = clean.split('/')[0].split('?')[0];
        const knownTabs = ['home', 'rules', 'requests', 'profile', 'configurations', 'credits'];
        if (knownTabs.includes(firstSegment)) {
          return router.parseUrl('/t/' + clean);
        }
        return router.parseUrl('/t/home');
      }
    ],
    children: []
  }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      preloadingStrategy: PreloadAllModules,
      bindToComponentInputs: true
    })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}
