import { Injectable } from '@angular/core';
import { Router, NavigationEnd, NavigationStart } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class NavigationHistoryService {
  private history: string[] = [];
  private lastNonDetailUrl: string | null = null;

  constructor(private router: Router) {
    this.init();
  }

  private init(): void {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (event.navigationTrigger === 'popstate') {
          // Native browser back/forward button pressed
          if (this.history.length > 1 && event.url === this.history[this.history.length - 2]) {
            this.history.pop();
          }
        }
      } else if (event instanceof NavigationEnd) {
        const url = event.urlAfterRedirects;

        // Remember the last page before entering a request view or review page
        if (!this.isDetailUrl(url)) {
          this.lastNonDetailUrl = url;
        }

        // Avoid pushing consecutive duplicate URLs
        if (this.history.length === 0 || this.history[this.history.length - 1] !== url) {
          this.history.push(url);
        }
      }
    });
  }

  private isDetailUrl(url: string): boolean {
    return url.includes('/requests/view') || url.includes('/requests/review');
  }

  /**
   * Returns the immediate previous URL in the navigation stack, if available.
   */
  public getPreviousUrl(): string | null {
    if (this.history.length > 1) {
      return this.history[this.history.length - 2];
    }
    return null;
  }

  /**
   * Returns the URL of the page from where the user entered the view/review flow.
   */
  public getLastNonDetailUrl(): string | null {
    return this.lastNonDetailUrl;
  }

  /**
   * Navigates back to the previous page that was visited before the current view/review page.
   * If no previous page is stored (e.g. opened directly or refreshed), falls back to fallbackUrl.
   */
  public goBack(fallbackUrl: string): void {
    if (this.history.length > 1) {
      this.history.pop(); // Remove current URL
      const targetUrl = this.history.pop(); // Pop target so NavigationEnd pushes it back cleanly
      if (targetUrl) {
        this.router.navigateByUrl(targetUrl);
        return;
      }
    }

    if (this.lastNonDetailUrl && this.lastNonDetailUrl !== this.router.url) {
      this.router.navigateByUrl(this.lastNonDetailUrl);
      return;
    }

    this.router.navigateByUrl(fallbackUrl);
  }
}
