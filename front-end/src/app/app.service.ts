import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { environment as env } from '@env';
import { User } from '@models/user.model';

import { Router } from '@angular/router';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const LANG_KEY = 'app_lang';
const THEME_PREFERENCE_STORAGE_KEY = 'themePreference';
const DEFAULT_BANK_KEY = 'user_default_bank';

export type ThemePreference = 'auto' | 'dark' | 'light';

@Injectable({
  providedIn: 'root'
})
export class AppService {
  private _storage: Storage | null = null;
  private _ready = false;

  public themePreference: ThemePreference = 'auto';
  private darkMode = false;

  private userSubject = new BehaviorSubject<User | null>(null);
  public user$: Observable<User | null> = this.userSubject.asObservable();

  private tokenSubject = new BehaviorSubject<string | null>(null);
  public token$: Observable<string | null> = this.tokenSubject.asObservable();

  constructor(
    private storage: Storage,
    private translate: TranslateService,
    private titleService: Title,
    private router: Router
  ) {
    this.themePreference = this.loadStoredThemePreference();
    this.updateDarkMode();
    this.listenToSystemColorScheme();

    this.translate.onLangChange.subscribe(() => {
      this.updateTitle();
    });
  }

  public async init(): Promise<void> {
    if (this._ready) return;

    this._storage = await this.storage.create();

    // Initialize translations
    this.translate.addLangs(['en', 'pl']);
    this.translate.setDefaultLang('en');

    const savedLang = await this._storage.get(LANG_KEY);
    const browserLang = this.translate.getBrowserLang();
    const langToUse = savedLang || (browserLang && ['en', 'pl'].includes(browserLang) ? browserLang : 'en');
    await this.setLanguage(langToUse);

    // Load saved auth state
    const savedToken = await this._storage.get(TOKEN_KEY);
    const savedUser = await this._storage.get(USER_KEY);

    if (savedToken && this.isTokenValid(savedToken)) {
      this.tokenSubject.next(savedToken);
      if (savedUser) {
        const u = new User(savedUser);
        this.userSubject.next(u);
      } else {
        const parsed = this.parseTokenPayload(savedToken);
        if (parsed) {
          const u = new User(parsed);
          this.userSubject.next(u);
          await this._storage.set(USER_KEY, parsed);
        }
      }
    } else {
      await this.clearAuth();
    }

    this._ready = true;
  }

  public get currentUser(): User | null {
    return this.userSubject.value;
  }

  public get currentToken(): string | null {
    return this.tokenSubject.value;
  }

  public get isAuthenticated(): boolean {
    const token = this.currentToken;
    return !!token && this.isTokenValid(token);
  }

  public async setToken(token: string): Promise<User | null> {
    if (!this._storage) {
      await this.init();
    }

    const payload = this.parseTokenPayload(token);
    await this._storage?.set(TOKEN_KEY, token);
    let user: User | null = null;
    if (payload) {
      user = new User(payload);
      await this._storage?.set(USER_KEY, payload);
      this.userSubject.next(user);
    }
    this.tokenSubject.next(token);
    return user;
  }

  public async logout(): Promise<void> {
    await this.clearAuth();
    await this.router.navigate(['/auth'], { replaceUrl: true });
  }

  public goTo(route: string | any[]): void {
    if (Array.isArray(route)) {
      this.router.navigate(route);
    } else {
      this.router.navigate([route]);
    }
  }

  public isInMobileMode(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 768;
  }

  public async getDefaultBankDetails(): Promise<{
    accountHolderName?: string;
    accountHolderAddress?: string;
    iban?: string;
    swiftBic?: string;
  } | null> {
    if (!this._storage) await this.init();
    return (await this._storage?.get(DEFAULT_BANK_KEY)) || null;
  }

  public async saveDefaultBankDetails(details: {
    accountHolderName?: string;
    accountHolderAddress?: string;
    iban?: string;
    swiftBic?: string;
  }): Promise<void> {
    if (!this._storage) await this.init();
    await this._storage?.set(DEFAULT_BANK_KEY, details);
  }

  private async clearAuth(): Promise<void> {
    if (this._storage) {
      await this._storage.remove(TOKEN_KEY);
      await this._storage.remove(USER_KEY);
    }
    this.tokenSubject.next(null);
    this.userSubject.next(null);
  }

  public async setLanguage(lang: string): Promise<void> {
    await this.translate.use(lang).toPromise();
    this.updateTitle();
    if (this._storage) {
      await this._storage.set(LANG_KEY, lang);
    }
  }

  public updateTitle(): void {
    this.translate.get('APP.TITLE').subscribe((title: string) => {
      if (title && title !== 'APP.TITLE') {
        this.titleService.setTitle(title);
      }
    });
  }

  public get currentLanguage(): string {
    return this.translate.currentLang || this.translate.defaultLang || 'en';
  }

  private loadStoredThemePreference(): ThemePreference {
    try {
      const saved = localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY) as ThemePreference;
      if (saved === 'auto' || saved === 'dark' || saved === 'light') {
        return saved;
      }
    } catch (_) {}
    return 'auto';
  }

  private listenToSystemColorScheme(): void {
    if (typeof window !== 'undefined' && window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.themePreference === 'auto') {
          this.updateDarkMode();
        }
      });
    }
  }

  private updateDarkMode(): void {
    const prefersDark =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (this.themePreference === 'dark') {
      this.darkMode = true;
    } else if (this.themePreference === 'light') {
      this.darkMode = false;
    } else {
      this.darkMode = prefersDark;
    }

    if (typeof document !== 'undefined') {
      document.body.classList.toggle('dark', this.darkMode);
      try {
        document.documentElement.style.colorScheme = this.darkMode ? 'dark' : 'light';
      } catch (_) {}
    }
  }

  public setThemePreference(theme: ThemePreference): void {
    if (this.themePreference === theme) return;
    this.themePreference = theme;
    try {
      localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, theme);
    } catch (_) {}
    this.updateDarkMode();
  }

  public getThemePreference(): ThemePreference {
    return this.themePreference;
  }

  public cycleThemePreference(): void {
    const systemIsDark =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (this.themePreference === 'auto') {
      this.setThemePreference(systemIsDark ? 'light' : 'dark');
    } else if (this.themePreference === (systemIsDark ? 'light' : 'dark')) {
      this.setThemePreference(systemIsDark ? 'dark' : 'light');
    } else {
      this.setThemePreference('auto');
    }
  }

  public getThemeIcon(): string {
    if (this.themePreference === 'dark') return 'moon-outline';
    if (this.themePreference === 'light') return 'sunny-outline';
    return 'contrast-outline';
  }

  public getThemeLabel(): string {
    if (this.themePreference === 'dark') return this.translate.instant('COMMON.THEME_DARK');
    if (this.themePreference === 'light') return this.translate.instant('COMMON.THEME_LIGHT');
    return this.translate.instant('COMMON.THEME_AUTO');
  }

  public isInDarkMode(): boolean {
    return this.darkMode;
  }

  public startLoginFlow(): void {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const port = window.location.port ? window.location.port : '8100';
    const localhostParam = isLocal ? `?localhost=${port}` : '';
    const apiLoginURL = `https://${env.idea.api.url}/${env.idea.api.stage}/login`;
    const casLoginUrl = `https://accounts.esn.org/cas/login?service=${encodeURIComponent(apiLoginURL + localhostParam)}`;

    window.location.href = casLoginUrl;
  }

  private parseTokenPayload(token: string): any {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  private isTokenValid(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return false;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.exp) return true;
      return Date.now() < payload.exp * 1000;
    } catch {
      return false;
    }
  }
}
