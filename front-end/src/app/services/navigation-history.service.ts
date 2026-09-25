import { Injectable } from '@angular/core';
import { Router, NavigationEnd, NavigationStart } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class NavigationHistoryService {
  private requestStack: string[] = [];
  private lastContextUrl: string | null = null;
  private currentUrl: string | null = null;

  constructor(private router: Router) {
    this.init();
  }

  private init(): void {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (event.navigationTrigger === 'popstate') {
          // Native browser back/forward button handled by router
        }
      } else if (event instanceof NavigationEnd) {
        const prevUrl = this.currentUrl;
        const url = event.urlAfterRedirects;
        this.currentUrl = url;
        this.handleNavigationEnd(url, prevUrl);
      }
    });
  }

  private handleNavigationEnd(url: string, prevUrl: string | null): void {
    if (this.isDetailUrl(url)) {
      const normUrl = this.normalizeUrl(url);
      const existingIndex = this.requestStack.findIndex((u) => this.normalizeUrl(u) === normUrl);

      if (existingIndex !== -1) {
        // Navigated back or returned to a URL already in the request stack
        this.requestStack = this.requestStack.slice(0, existingIndex + 1);
        return;
      }

      const currentDetailKey = this.getRequestKey(url);
      const topStackKey = this.getTopStackDetailKey();

      if (currentDetailKey && topStackKey && currentDetailKey === topStackKey) {
        // Transitioning between view and review modes of the same request
        this.requestStack.push(url);
      } else {
        // A new request detail flow is starting.
        // Determine the referrer: prefer prevUrl if it was a valid context URL,
        // otherwise fallback to the last known valid context URL.
        let referrer: string | null = null;
        if (prevUrl && this.isValidContextUrl(prevUrl)) {
          referrer = prevUrl;
        } else if (this.lastContextUrl && this.isValidContextUrl(this.lastContextUrl)) {
          referrer = this.lastContextUrl;
        }

        if (referrer && this.normalizeUrl(referrer) !== normUrl) {
          this.requestStack = [referrer, url];
        } else {
          this.requestStack = [url];
        }
      }
    } else {
      // Non-detail URL
      if (this.isValidContextUrl(url)) {
        this.lastContextUrl = url;
        // When user explicitly visits the primary request list pages, reset the request flow stack
        const clean = this.normalizeUrl(url).split('?')[0].split('#')[0];
        if (clean === '/t/requests' || clean === '/t/requests/manage') {
          this.requestStack = [];
        }
      }
    }
  }

  public isDetailUrl(url: string): boolean {
    if (!url) return false;
    return url.includes('/requests/view') || url.includes('/requests/review');
  }

  private isValidContextUrl(url: string): boolean {
    if (!url) return false;
    const cleanUrl = this.normalizeUrl(url).split('?')[0].split('#')[0];

    // Explicitly exclude non-request tabs that never contain or originate requests
    if (
      cleanUrl.startsWith('/t/profile') ||
      cleanUrl.startsWith('/t/rules') ||
      cleanUrl.startsWith('/t/credits')
    ) {
      return false;
    }

    // Detail pages are handled separately
    if (this.isDetailUrl(cleanUrl)) {
      return false;
    }

    // Valid entry points: /t/requests (My Requests), /t/requests/manage (Manage Requests),
    // /t/home (Dashboard), /t/configurations (Configurations)
    return (
      cleanUrl === '/t/requests' ||
      cleanUrl === '/t/requests/manage' ||
      cleanUrl.startsWith('/t/home') ||
      cleanUrl.startsWith('/t/configurations')
    );
  }

  public getRequestKey(url: string): string | null {
    if (!url) return null;
    const match = url.match(/\/requests\/(?:manage\/)?(?:view|review)\/(.+)$/);
    if (match) {
      return match[1].split('?')[0].split('#')[0];
    }
    return null;
  }

  private getTopStackDetailKey(): string | null {
    for (let i = this.requestStack.length - 1; i >= 0; i--) {
      const key = this.getRequestKey(this.requestStack[i]);
      if (key) {
        return key;
      }
    }
    return null;
  }

  private normalizeUrl(url: string): string {
    if (!url) return '';
    return url.replace(/\/+$/, '');
  }

  /**
   * Returns the immediate previous URL in the request navigation stack, if available.
   */
  public getPreviousUrl(): string | null {
    if (this.requestStack.length > 1) {
      return this.requestStack[this.requestStack.length - 2];
    }
    return this.lastContextUrl;
  }

  /**
   * Returns the URL of the page from where the user entered the view/review flow.
   */
  public getLastNonDetailUrl(): string | null {
    if (this.requestStack.length > 0 && !this.isDetailUrl(this.requestStack[0])) {
      return this.requestStack[0];
    }
    return this.lastContextUrl;
  }

  /**
   * Navigates back to the previous page in the request context before the current view/review page.
   * If no previous page is stored (e.g. opened directly or refreshed), falls back to fallbackUrl.
   */
  public goBack(fallbackUrl: string): void {
    while (this.requestStack.length > 1) {
      this.requestStack.pop();
      const targetUrl = this.requestStack[this.requestStack.length - 1];
      if (targetUrl && this.normalizeUrl(targetUrl) !== this.normalizeUrl(this.router.url)) {
        this.router.navigateByUrl(targetUrl);
        return;
      }
    }

    if (
      this.lastContextUrl &&
      this.normalizeUrl(this.lastContextUrl) !== this.normalizeUrl(this.router.url) &&
      this.isValidContextUrl(this.lastContextUrl)
    ) {
      const target = this.lastContextUrl;
      this.requestStack = [];
      this.router.navigateByUrl(target);
      return;
    }

    this.requestStack = [];
    this.router.navigateByUrl(fallbackUrl);
  }
}
