import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';
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
    redirectTo: 't/home'
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
