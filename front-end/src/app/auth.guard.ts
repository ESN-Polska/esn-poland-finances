import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AppService } from './app.service';

export const authGuard: CanActivateFn = async (route, state) => {
  const appService = inject(AppService);
  const router = inject(Router);

  await appService.init();

  let targetUrl = state?.url;
  if (!targetUrl || targetUrl === '/' || targetUrl === '/home') {
    if (typeof window !== 'undefined' && window.location?.pathname && window.location.pathname !== '/' && window.location.pathname !== '/auth') {
      targetUrl = window.location.pathname + window.location.search + (window.location.hash || '');
    }
  } else if (targetUrl && typeof window !== 'undefined' && window.location?.hash && !targetUrl.includes('#')) {
    targetUrl += window.location.hash;
  }

  const validReturnUrl = appService.getValidReturnUrl(targetUrl);

  if (appService.isAuthenticated) {
    if (!appService.realUser?.isAdministrator) {
      const isLocked = await appService.checkAppLockForCurrentUser();
      if (isLocked) {
        if (validReturnUrl) {
          appService.setReturnUrl(validReturnUrl);
        }
        return router.createUrlTree(['/auth'], {
          queryParams: validReturnUrl ? { returnUrl: validReturnUrl } : {}
        });
      }
    }
    return true;
  }

  if (validReturnUrl) {
    appService.setReturnUrl(validReturnUrl);
  }

  return router.createUrlTree(['/auth'], {
    queryParams: validReturnUrl ? { returnUrl: validReturnUrl } : {}
  });
};
