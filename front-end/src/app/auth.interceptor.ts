import { Injectable, Injector, inject } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppService } from './app.service';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private injector = inject(Injector);

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    // Ignore static asset requests like i18n JSON files
    if (req.url.includes('/assets/') || req.url.endsWith('.json')) {
      return next.handle(req);
    }

    return next.handle(req).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 || error.status === 403) {
          try {
            const appService = this.injector.get(AppService);
            const rawMsg = String(error?.error?.message || error?.message || '').toLowerCase();
            const isSuspended =
              rawMsg.includes('suspended') ||
              (appService.configurations?.blockedUserIds || []).some(
                (id: string) => id.toLowerCase() === appService.currentUser?.userId?.toLowerCase()
              );
            if (
              (error.status === 401 ||
                (error.status === 403 && (appService.configurations?.appLocked || isSuspended))) &&
              appService.isAuthenticated &&
              !appService.currentUser?.isAdministrator
            ) {
              if (isSuspended) {
                appService.logout('suspended');
              } else {
                const isLocked = Boolean(
                  appService.configurations?.appLocked || rawMsg.includes('locked')
                );
                appService.logout(isLocked ? 'lock' : false);
              }
            }
          } catch {
            // Guard against DI resolution issues
          }
        }
        return throwError(() => error);
      })
    );
  }
}
