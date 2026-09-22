import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { IDEAApiService } from '@idea-ionic/common';

import { environment as env } from '@env';
import { User } from '@models/user.model';
import { ALL_APP_PERMISSIONS, Configurations, CustomRole, AppPermission } from '@models/configurations.model';
import { ConfigurationsService } from './tabs/configurations/configurations.service';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';
const LANG_KEY = 'app_lang';
const THEME_PREFERENCE_STORAGE_KEY = 'themePreference';
const DEFAULT_BANK_KEY = 'user_default_bank';

const APP_ICON_DEFAULT = 'assets/icons/icon.svg';

export type ThemePreference = 'auto' | 'dark' | 'light';

@Injectable({
  providedIn: 'root'
})
export class AppService {
  private _storage: Storage | null = null;
  private _ready = false;

  public configurations: Configurations = new Configurations({ PK: Configurations.PK });

  // Preview / Impersonation State
  public originalUser: User | null = null;
  public isImpersonating = false;
  public impersonatedRole = 'STANDARD_USER';
  public impersonatedPersonaTitle = '';

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
    private router: Router,
    private api: IDEAApiService,
    private configurationsService: ConfigurationsService
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

    // Load configurations from backend
    await this.loadConfigurations();

    // Load saved auth state
    const savedToken = await this._storage.get(TOKEN_KEY);
    const savedUser = await this._storage.get(USER_KEY);

    if (savedToken && this.isTokenValid(savedToken)) {
      this.tokenSubject.next(savedToken);
      this.api.authToken = savedToken;

      if (savedUser) {
        const u = new User(savedUser);
        User.applyConfigurationPermissions(u, this.configurations);
        this.userSubject.next(u);
      } else {
        const parsed = this.parseTokenPayload(savedToken);
        if (parsed) {
          const u = new User(parsed);
          User.applyConfigurationPermissions(u, this.configurations);
          this.userSubject.next(u);
          await this._storage.set(USER_KEY, parsed);
        }
      }
    } else {
      await this.clearAuth();
    }

    this._ready = true;
  }

  public async loadConfigurations(): Promise<Configurations> {
    try {
      this.configurations = await this.configurationsService.get();
      if (this.currentUser) {
        User.applyConfigurationPermissions(this.currentUser, this.configurations);
      }
    } catch {
      // Keep existing/default configurations if backend is unreachable
    }
    this.updateTitle();
    return this.configurations;
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

    this.api.authToken = token;
    const payload = this.parseTokenPayload(token);
    await this._storage?.set(TOKEN_KEY, token);

    let user: User | null = null;
    if (payload) {
      user = new User(payload);
      User.applyConfigurationPermissions(user, this.configurations);
      await this._storage?.set(USER_KEY, payload);
      this.userSubject.next(user);
    }
    this.tokenSubject.next(token);
    return user;
  }

  public async logout(): Promise<void> {
    if (this.isImpersonating) {
      this.exitPreview(false);
    }
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

  /**
   * Get the active app logo based on theme and configuration.
   */
  public getIcon(white = false): string {
    if (white) {
      return this.configurations?.appLogoURLDarkMode || this.configurations?.appLogoURL || APP_ICON_DEFAULT;
    }
    return this.configurations?.appLogoURL || APP_ICON_DEFAULT;
  }

  /**
   * Resolve an image URI into an absolute CDN URL.
   */
  public getImageURLByURI(imageURI: string): string {
    const stage = env.idea?.api?.stage || 'dev';
    return `https://${env.parameters.mediaDomain}/images/${stage}/${imageURI}.png`;
  }

  /**
   * Open user profile on accounts.esn.org.
   */
  public openUserProfileById(userId: string): void {
    if (userId) {
      window.open(`https://accounts.esn.org/user/${encodeURIComponent(userId)}`, '_blank', 'noopener,noreferrer');
    }
  }

  //
  // PREVIEW / IMPERSONATION SYSTEM
  //

  public seeAsStandardUser(navigate = true): void {
    const current = this.currentUser;
    if (!current) return;

    if (!this.isImpersonating) {
      this.originalUser = new User(current);
    }
    this.isImpersonating = true;
    this.impersonatedRole = 'STANDARD_USER';
    this.impersonatedPersonaTitle = this.translate.instant('CONFIGURATIONS.STANDARD_USER');

    const impersonated = new User(this.originalUser);
    impersonated.isAdministrator = false;
    impersonated.isManager = false;
    impersonated.isAuditor = false;
    impersonated.canManageFinances = false;
    impersonated.permissions = [];
    impersonated.customRoleIds = [];
    this.userSubject.next(impersonated);

    if (navigate) {
      this.goTo(['/t/home']);
    }
  }

  public seeAsManager(navigate = true): void {
    const current = this.currentUser;
    if (!current) return;

    if (!this.isImpersonating) {
      this.originalUser = new User(current);
    }
    this.isImpersonating = true;
    this.impersonatedRole = 'MANAGER';
    this.impersonatedPersonaTitle = this.translate.instant('CONFIGURATIONS.MANAGER');

    const impersonated = new User(this.originalUser);
    impersonated.isAdministrator = false;
    impersonated.isManager = true;
    impersonated.isAuditor = false;
    impersonated.canManageFinances = true;
    // All current and future permissions except configurations
    const configurationsPrefix = AppPermission.CONFIGURATIONS.PARENT;
    impersonated.permissions = ALL_APP_PERMISSIONS.filter(
      perm => perm !== configurationsPrefix && !perm.startsWith(`${configurationsPrefix}.`)
    );
    this.userSubject.next(impersonated);

    if (navigate) {
      this.goTo(['/t/home']);
    }
  }

  public seeAsAuditor(navigate = true): void {
    const current = this.currentUser;
    if (!current) return;

    if (!this.isImpersonating) {
      this.originalUser = new User(current);
    }
    this.isImpersonating = true;
    this.impersonatedRole = 'AUDITOR';
    this.impersonatedPersonaTitle = this.translate.instant('CONFIGURATIONS.AUDITOR');

    const impersonated = new User(this.originalUser);
    impersonated.isAdministrator = false;
    impersonated.isManager = false;
    impersonated.isAuditor = true;
    impersonated.canManageFinances = false;
    impersonated.permissions = [
      AppPermission.FINANCIAL_REQUESTS.VIEW_ALL,
      AppPermission.FINANCIAL_REQUESTS.EXPORT
    ];
    impersonated.customRoleIds = [];
    this.userSubject.next(impersonated);

    if (navigate) {
      this.goTo(['/t/home']);
    }
  }

  public seeAsCustomRole(customRole: CustomRole, navigate = true): void {
    const current = this.currentUser;
    if (!current || !customRole) return;

    if (!this.isImpersonating) {
      this.originalUser = new User(current);
    }
    this.isImpersonating = true;
    this.impersonatedRole = `CUSTOM_ROLE:${customRole.id}`;
    this.impersonatedPersonaTitle = customRole.name;

    const impersonated = new User(this.originalUser);
    impersonated.isAdministrator = false;
    impersonated.isManager = false;
    impersonated.isAuditor = false;
    impersonated.canManageFinances = false;
    impersonated.permissions = [...(customRole.permissions || [])];
    impersonated.customRoleIds = [customRole.id];
    this.userSubject.next(impersonated);

    if (navigate) {
      this.goTo(['/t/home']);
    }
  }

  /**
   * Switch the persona directly while remaining on the current view.
   */
  public changeImpersonatedRole(role: string): void {
    if (!role) return;
    if (role === 'STANDARD_USER') {
      this.seeAsStandardUser(false);
    } else if (role === 'MANAGER') {
      this.seeAsManager(false);
    } else if (role === 'AUDITOR') {
      this.seeAsAuditor(false);
    } else if (role.startsWith('CUSTOM_ROLE:')) {
      const roleId = role.replace('CUSTOM_ROLE:', '');
      const customRole = this.configurations?.customRoles?.find(x => x.id === roleId);
      if (customRole) {
        this.seeAsCustomRole(customRole, false);
      }
    }
  }

  public exitPreview(navigate = true): void {
    if (this.originalUser) {
      const restoredUser = new User(this.originalUser);
      User.applyConfigurationPermissions(restoredUser, this.configurations);
      this.userSubject.next(restoredUser);
      this.originalUser = null;
    }
    this.isImpersonating = false;
    this.impersonatedRole = 'STANDARD_USER';
    this.impersonatedPersonaTitle = '';

    if (navigate) {
      this.goTo(['/t/configurations']);
    }
  }

  public exitSeeAs(navigate = true): void {
    this.exitPreview(navigate);
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
    this.api.authToken = null as any;
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

  public async toggleLanguage(): Promise<void> {
    const nextLang = this.currentLanguage === 'pl' ? 'en' : 'pl';
    await this.setLanguage(nextLang);
  }

  public getAppTitle(): string {
    return this.configurations?.getAppTitle(this.currentLanguage) || '';
  }

  public getAppSubtitle(): string {
    return this.configurations?.getAppSubtitle(this.currentLanguage) || '';
  }

  public updateTitle(): void {
    const title = this.getAppTitle();
    if (title) {
      this.titleService.setTitle(title);
    }
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
    const hostname = window.location.hostname;
    const isLocal =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

    const port = window.location.port || '8100';
    const localHost = window.location.port ? window.location.host : `${hostname}:${port}`;
    const localhostParam = isLocal ? `?localhost=${localHost}` : '';
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

  public getUserRoleKey(user?: User | null): string {
    const targetUser =
      this.isImpersonating && (!user || user.userId === this.originalUser?.userId)
        ? this.currentUser
        : (user || this.currentUser);

    if (!targetUser) return 'STANDARD_USER';
    if (targetUser.isAdministrator) return 'ADMINISTRATOR';
    if (targetUser.isManager) return 'MANAGER';
    if (targetUser.isAuditor) return 'AUDITOR';
    if (targetUser.customRoleIds && targetUser.customRoleIds.length > 0) return 'CUSTOM';
    return 'STANDARD_USER';
  }

  public getUserRoleName(user?: User | null): string {
    const targetUser =
      this.isImpersonating && (!user || user.userId === this.originalUser?.userId)
        ? this.currentUser
        : (user || this.currentUser);

    if (!targetUser) return '';
    if (targetUser.isAdministrator) return this.translate.instant('CONFIGURATIONS.ADMINISTRATOR');
    if (targetUser.isManager) return this.translate.instant('CONFIGURATIONS.MANAGER');
    if (targetUser.isAuditor) return this.translate.instant('CONFIGURATIONS.AUDITOR');
    if (targetUser.customRoleIds && targetUser.customRoleIds.length > 0) {
      return this.translate.instant('CONFIGURATIONS.CUSTOM_ROLE');
    }
    return this.translate.instant('CONFIGURATIONS.STANDARD_USER');
  }

  public hasElevatedRole(user?: User | null): boolean {
    return this.getUserRoleKey(user) !== 'STANDARD_USER';
  }
}
