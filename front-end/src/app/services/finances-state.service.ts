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
    if (!computed.includes(this._activeYear$.value)) {
      computed.push(this._activeYear$.value);
      computed.sort((a, b) => b - a);
    }
    this._availableYears$.next(computed);
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
          if (!isNaN(parsedYear) && parsedYear !== this._activeYear$.value) {
            this.setYear(parsedYear, false);
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
    if (this._activeYear$.value === year) return;
    this._activeYear$.next(year);
    // Mark previous years as archived / read-only by default (except current active operational year)
    const currentYear = new Date().getFullYear();
    this._isArchived$.next(year < currentYear);

    if (!this._availableYears$.value.includes(year)) {
      this.addYear(year);
    }

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
