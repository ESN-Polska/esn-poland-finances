import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { AppService } from './app.service';

export const initGuard: CanActivateFn = async () => {
  const appService = inject(AppService);
  await appService.init();
  return true;
};
