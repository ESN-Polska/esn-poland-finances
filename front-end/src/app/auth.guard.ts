import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppService } from './app.service';

export const authGuard: CanActivateFn = async () => {
  const appService = inject(AppService);
  const router = inject(Router);

  await appService.init();

  if (appService.isAuthenticated) {
    if (!appService.currentUser?.isAdministrator) {
      const isLocked = await appService.checkAppLockForCurrentUser();
      if (isLocked) {
        return router.createUrlTree(['/auth']);
      }
    }
    return true;
  }

  return router.createUrlTree(['/auth']);
};
