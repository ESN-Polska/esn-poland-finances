import { Injectable, inject } from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { BehaviorSubject, Observable, filter } from 'rxjs';
import { AppService } from '../app.service';

export function computeAvailableYears(firstYear?: number): number[] {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const start = (firstYear && !isNaN(firstYear) && firstYear >= 1900) ? Math.floor(firstYear) : currentYear;
  const minYear = Math.min(start, currentYear);
  const maxYear = Math.max(start, nextYear);
  const years: number[] = [];
  for (let y = maxYear; y >= minYear; y--) {
    years.push(y);
  }
  return years;
}

@Injectable({ providedIn: 'root' })
export class FinancesStateService {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private appService = inject(AppService);

  private readonly _activeYear$ = new BehaviorSubject<number>(new Date().getFullYear());
  public readonly activeYear$: Observable<number> = this._activeYear$.asObservable();

  private readonly _activeSubtab$ = new BehaviorSubject<string>('SUMMARY');
  public readonly activeSubtab$: Observable<string> = this._activeSubtab$.asObservable();

  private readonly _availableYears$ = new BehaviorSubject<number[]>(computeAvailableYears(new Date().getFullYear()));
  public readonly availableYears$: Observable<number[]> = this._availableYears$.asObservable();

  private readonly _isArchived$ = new BehaviorSubject<boolean>(false);
  public readonly isArchived$: Observable<boolean> = this._isArchived$.asObservable();

  constructor() {
    this.refreshAvailableYears(this.appService.configurations?.financesConfig?.firstYear);
    this.initFromRoute();
  }

  public refreshAvailableYears(firstYear?: number): void {
    const configFirstYear = firstYear ?? this.appService.configurations?.financesConfig?.firstYear;
    const computed = computeAvailableYears(configFirstYear);
    this._availableYears$.next(computed);
    if (!computed.includes(this._activeYear$.value)) {
      const fallbackYear = computed.includes(new Date().getFullYear()) ? new Date().getFullYear() : computed[0];
      this.setYear(fallbackYear, true);
    }
  }

  public isYearAvailable(year: number): boolean {
    return this._availableYears$.value.includes(year);
  }

  private initFromRoute(): void {
    // Listen to route events to synchronize active year & subtab from URL query parameters
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      let currentRoute: ActivatedRoute | null = this.route;
      while (currentRoute.firstChild) {
        currentRoute = currentRoute.firstChild;
      }
      currentRoute.queryParams.subscribe((params) => {
        if (params['year']) {
          const parsedYear = parseInt(params['year'], 10);
          if (!isNaN(parsedYear)) {
            const available = this._availableYears$.value;
            if (available.includes(parsedYear)) {
              if (parsedYear !== this._activeYear$.value) {
                this.setYear(parsedYear, false);
              }
            } else {
              // Year is not valid/does not exist: redirect URL and active year to fallback
              const fallbackYear = available.includes(this._activeYear$.value)
                ? this._activeYear$.value
                : (available.includes(new Date().getFullYear()) ? new Date().getFullYear() : available[0]);
              this.setYear(fallbackYear, true);
            }
          }
        }
        if (params['subtab'] && params['subtab'] !== this._activeSubtab$.value) {
          this._activeSubtab$.next(params['subtab'].toUpperCase());
        }
      });
    });
  }

  public get activeYear(): number {
    return this._activeYear$.value;
  }

  public get activeSubtab(): string {
    return this._activeSubtab$.value;
  }

  public get isArchived(): boolean {
    return this._isArchived$.value;
  }

  public setYear(year: number, updateUrl: boolean = true): void {
    const available = this._availableYears$.value;
    if (!available.includes(year)) {
      const fallback = available.includes(new Date().getFullYear()) ? new Date().getFullYear() : available[0];
      year = fallback;
      updateUrl = true;
    }

    if (this._activeYear$.value === year) {
      if (updateUrl) {
        this.router.navigate([], {
          queryParams: { year, code: null, targetId: null },
          queryParamsHandling: 'merge'
        });
      }
      return;
    }

    this._activeYear$.next(year);
    // Mark previous years as archived / read-only by default (except current active operational year)
    const currentYear = new Date().getFullYear();
    this._isArchived$.next(year < currentYear);

    if (updateUrl) {
      this.router.navigate([], {
        queryParams: { year, code: null, targetId: null },
        queryParamsHandling: 'merge'
      });
    }
  }

  public setSubtab(subtab: string, updateUrl: boolean = true): void {
    const upper = subtab.toUpperCase();
    const isDifferent = this._activeSubtab$.value !== upper;
    if (isDifferent) {
      this._activeSubtab$.next(upper);
    }

    if (updateUrl) {
      this.router.navigate([], {
        queryParams: { subtab: upper, code: null, targetId: null },
        queryParamsHandling: 'merge'
      });
    }
  }

  public addYear(year: number): void {
    const list = this._availableYears$.value;
    if (!list.includes(year)) {
      const updated = [year, ...list].sort((a, b) => b - a);
      this._availableYears$.next(updated);
    }
  }
}
