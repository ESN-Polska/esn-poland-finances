import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppService } from './app.service';

export const authGuard: CanActivateFn = async () => {
  const appService = inject(AppService);
  const router = inject(Router);

  await appService.init();

  if (appService.isAuthenticated) {
    return true;
  }

  return router.createUrlTree(['/auth']);
};
