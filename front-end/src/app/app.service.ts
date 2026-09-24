import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Storage } from '@ionic/storage-angular';
import { BehaviorSubject, Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { ToastController } from '@ionic/angular';
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
const IMPERSONATION_ROLE_STORAGE_KEY = 'app_impersonation_role';

const APP_ICON_DEFAULT = 'assets/icons/icon.svg';
const ORGANISATION_LOGO_DEFAULT = 'assets/images/esn-poland-logo.png';

export type ThemePreference = 'auto' | 'dark' | 'light';
export type AccentColor = 'default' | 'cyan' | 'pink' | 'green' | 'orange' | 'darkBlue';
const ACCENT_COLOR_STORAGE_KEY = 'accentColor';

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
  public accentColor: AccentColor = 'default';
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
    private toastCtrl: ToastController,
    private api: IDEAApiService,
    private configurationsService: ConfigurationsService
  ) {
    this.themePreference = this.loadStoredThemePreference();
    this.updateDarkMode();
    this.listenToSystemColorScheme();
    this.accentColor = this.loadStoredAccentColor();
    this.updateAccentColor();
    this.setupLockMonitoring();

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

      let u: User | null = null;
      if (savedUser) {
        u = new User(savedUser);
        User.applyConfigurationPermissions(u, this.configurations);
        this.userSubject.next(u);
      } else {
        const parsed = this.parseTokenPayload(savedToken);
        if (parsed) {
          u = new User(parsed);
          User.applyConfigurationPermissions(u, this.configurations);
          this.userSubject.next(u);
          await this._storage.set(USER_KEY, parsed);
        }
      }

      if (u?.isAdministrator && typeof window !== 'undefined' && window.sessionStorage) {
        const savedImpersonationRole = window.sessionStorage.getItem(IMPERSONATION_ROLE_STORAGE_KEY);
        if (savedImpersonationRole) {
          this.changeImpersonatedRole(savedImpersonationRole);
        }
      }
    } else {
      this.clearPersistedImpersonationRole();
      await this.clearAuth();
    }

    this._ready = true;
  }

  public async loadConfigurations(): Promise<Configurations> {
    try {
      this.configurations = await this.configurationsService.get();
      if (this.currentUser) {
        if (this.isImpersonating) {
          if (this.originalUser) {
            User.applyConfigurationPermissions(this.originalUser, this.configurations);
          }
          this.changeImpersonatedRole(this.impersonatedRole);
        } else {
          User.applyConfigurationPermissions(this.currentUser, this.configurations);
        }
      }
      await this.checkAppLockForCurrentUser();
      if (this.isLanguageForced() && this.translate.currentLang !== this.getForcedLanguage()) {
        await this.setLanguage(this.getForcedLanguage()!);
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

  public get realUser(): User | null {
    return this.originalUser || this.currentUser;
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

  public async logout(dueToLock = false): Promise<void> {
    if (this.isImpersonating) {
      this.exitPreview(false);
    }
    this.clearPersistedImpersonationRole();
    await this.clearAuth();
    await this.router.navigate(['/auth'], { replaceUrl: true });
    if (dueToLock) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('AUTH.APP_LOCKED_NON_ADMIN_ERROR'),
        duration: 5000,
        color: 'warning',
        position: 'bottom'
      });
      await toast.present();
    }
  }

  public async checkAppLockForCurrentUser(): Promise<boolean> {
    if (!this.isAuthenticated || !this.realUser || this.realUser.isAdministrator) {
      return false;
    }

    const isLocked = Boolean(this.configurations?.appLocked);
    let isSessionRevoked = false;

    if (this.configurations?.appLockedAt && this.currentToken) {
      const payload = this.parseTokenPayload(this.currentToken);
      if (payload?.iat) {
        const lockedAtEpoch = Math.floor(new Date(this.configurations.appLockedAt).getTime() / 1000);
        if (payload.iat < lockedAtEpoch) {
          isSessionRevoked = true;
        }
      }
    }

    if (isLocked || isSessionRevoked) {
      await this.logout(true);
      return true;
    }

    return false;
  }

  private setupLockMonitoring(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('focus', () => {
      if (this.isAuthenticated && !this.realUser?.isAdministrator) {
        this.loadConfigurations();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.isAuthenticated && !this.realUser?.isAdministrator) {
        this.loadConfigurations();
      }
    });

    setInterval(() => {
      if (this.isAuthenticated && !this.realUser?.isAdministrator) {
        this.loadConfigurations();
      }
    }, 15000);
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
   * Get the active organisation logo.
   */
  public getOrganisationLogo(): string {
    return this.configurations?.organisationLogoURL || ORGANISATION_LOGO_DEFAULT;
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

  private persistImpersonationRole(role: string): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(IMPERSONATION_ROLE_STORAGE_KEY, role);
    }
  }

  private clearPersistedImpersonationRole(): void {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(IMPERSONATION_ROLE_STORAGE_KEY);
    }
  }

  public seeAsStandardUser(navigate = true): void {
    const current = this.realUser;
    if (!current) return;

    if (!this.isImpersonating) {
      this.originalUser = new User(current);
    }
    this.isImpersonating = true;
    this.impersonatedRole = 'STANDARD_USER';
    this.impersonatedPersonaTitle = this.translate.instant('CONFIGURATIONS.STANDARD_USER');
    this.persistImpersonationRole(this.impersonatedRole);

    const impersonated = new User(this.originalUser!);
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
    const current = this.realUser;
    if (!current) return;

    if (!this.isImpersonating) {
      this.originalUser = new User(current);
    }
    this.isImpersonating = true;
    this.impersonatedRole = 'MANAGER';
    this.impersonatedPersonaTitle = this.translate.instant('CONFIGURATIONS.MANAGER');
    this.persistImpersonationRole(this.impersonatedRole);

    const impersonated = new User(this.originalUser!);
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
    const current = this.realUser;
    if (!current) return;

    if (!this.isImpersonating) {
      this.originalUser = new User(current);
    }
    this.isImpersonating = true;
    this.impersonatedRole = 'AUDITOR';
    this.impersonatedPersonaTitle = this.translate.instant('CONFIGURATIONS.AUDITOR');
    this.persistImpersonationRole(this.impersonatedRole);

    const impersonated = new User(this.originalUser!);
    impersonated.isAdministrator = false;
    impersonated.isManager = false;
    impersonated.isAuditor = true;
    impersonated.canManageFinances = false;
    impersonated.permissions = [
      AppPermission.REQUESTS.VIEW_ALL,
      AppPermission.REQUESTS.EXPORT,
      AppPermission.HOME.STATISTICS
    ];
    impersonated.customRoleIds = [];
    this.userSubject.next(impersonated);

    if (navigate) {
      this.goTo(['/t/home']);
    }
  }

  public seeAsCustomRole(customRole: CustomRole, navigate = true): void {
    const current = this.realUser;
    if (!current || !customRole) return;

    if (!this.isImpersonating) {
      this.originalUser = new User(current);
    }
    this.isImpersonating = true;
    this.impersonatedRole = `CUSTOM_ROLE:${customRole.id}`;
    this.impersonatedPersonaTitle = customRole.name;
    this.persistImpersonationRole(this.impersonatedRole);

    const impersonated = new User(this.originalUser!);
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
    this.clearPersistedImpersonationRole();
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
    pln?: {
      accountHolderName?: string;
      accountHolderAddress?: string;
      iban?: string;
      swiftBic?: string;
      accountType?: 'DOMESTIC' | 'INTERNATIONAL';
    };
    eur?: {
      accountHolderName?: string;
      accountHolderAddress?: string;
      iban?: string;
      swiftBic?: string;
      accountType?: 'DOMESTIC' | 'INTERNATIONAL';
    };
  } | null> {
    if (!this._storage) await this.init();
    return (await this._storage?.get(DEFAULT_BANK_KEY)) || null;
  }

  public async saveDefaultBankDetails(details: {
    pln?: {
      accountHolderName?: string;
      accountHolderAddress?: string;
      iban?: string;
      swiftBic?: string;
      accountType?: 'DOMESTIC' | 'INTERNATIONAL';
    };
    eur?: {
      accountHolderName?: string;
      accountHolderAddress?: string;
      iban?: string;
      swiftBic?: string;
      accountType?: 'DOMESTIC' | 'INTERNATIONAL';
    };
  }): Promise<void> {
    if (!this._storage) await this.init();
    await this._storage?.set(DEFAULT_BANK_KEY, details);
  }

  public async clearAuth(): Promise<void> {
    this.api.authToken = null as any;
    if (this._storage) {
      await this._storage.remove(TOKEN_KEY);
      await this._storage.remove(USER_KEY);
    }
    this.tokenSubject.next(null);
    this.userSubject.next(null);
  }

  public isLanguageForced(): boolean {
    return !!this.configurations?.forcedLanguage && this.configurations.forcedLanguage !== 'ALL';
  }

  public getForcedLanguage(): string | null {
    return this.isLanguageForced() ? this.configurations.forcedLanguage : null;
  }

  public isLanguageAvailable(lang: string): boolean {
    if (!this.isLanguageForced()) return true;
    return this.getForcedLanguage() === lang;
  }

  public async setLanguage(lang: string): Promise<void> {
    const targetLang = this.isLanguageForced() ? this.getForcedLanguage()! : lang;
    await this.translate.use(targetLang).toPromise();
    this.updateTitle();
    if (this._storage) {
      await this._storage.set(LANG_KEY, targetLang);
    }
  }

  public async toggleLanguage(): Promise<void> {
    if (this.isLanguageForced()) return;
    const nextLang = this.currentLanguage === 'pl' ? 'en' : 'pl';
    await this.setLanguage(nextLang);
  }

  public getAppTitle(): string {
    return this.configurations?.getAppTitle(this.currentLanguage) || '';
  }

  public getAppOrganisation(): string {
    return this.configurations?.getAppOrganisation(this.currentLanguage) || '';
  }

  public updateTitle(): void {
    const title = this.getAppTitle();
    if (title) {
      this.titleService.setTitle(title);
    }
  }

  public get currentLanguage(): string {
    if (this.isLanguageForced()) {
      return this.getForcedLanguage()!;
    }
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

  private loadStoredAccentColor(): AccentColor {
    try {
      const saved = localStorage.getItem(ACCENT_COLOR_STORAGE_KEY) as AccentColor;
      if (['default', 'cyan', 'pink', 'green', 'orange', 'darkBlue'].includes(saved)) {
        return saved;
      }
    } catch (_) {}
    return 'default';
  }

  public setAccentColor(color: AccentColor): void {
    if (this.accentColor === color) return;
    this.accentColor = color;
    try {
      localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, color);
    } catch (_) {}
    this.updateAccentColor();
  }

  private updateAccentColor(): void {
    if (typeof document === 'undefined') return;
    const classList = document.body.classList;
    ['accent-cyan', 'accent-pink', 'accent-green', 'accent-orange', 'accent-darkBlue'].forEach(c =>
      classList.remove(c)
    );
    if (this.accentColor && this.accentColor !== 'default') {
      classList.add(`accent-${this.accentColor}`);
    }
  }


  public isLocalHost(hostname: string = typeof window !== 'undefined' ? window.location.hostname : ''): boolean {
    if (!hostname) return false;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('192.168.') ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      hostname.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  }

  public isLocalUrl(url?: string | null): boolean {
    if (!url) return false;
    return (
      url.includes('localhost') ||
      url.includes('127.0.0.1') ||
      /192\.168\.\d{1,3}\.\d{1,3}/.test(url) ||
      /10\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(url) ||
      /172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}/.test(url)
    );
  }

  public getPublicRedirectUri(): string {
    const stage = env.stage || env.idea?.api?.stage || 'dev';
    const domain = stage === 'prod' ? 'finances.esn-poland.link' : 'dev.finances.esn-poland.link';
    return `https://${domain}/auth`;
  }

  public async startLoginFlow(): Promise<void> {
    // Dynamically retrieve OAuth config from backend (which securely loads clientId from SSM)
    let oauthConfig: any;
    try {
      oauthConfig = await this.api.getResource('login');
    } catch (err) {
      console.error('Failed to load OAuth config from server', err);
      throw err;
    }

    const clientId = oauthConfig?.clientId;
    if (!clientId) {
      throw new Error('OAuth Client ID not configured on server');
    }

    const hostname = window.location.hostname;
    const isLocal = this.isLocalHost(hostname);

    // If local, the redirect_uri sent to accounts.esn.org MUST be the deployed dev callback URL,
    // NEVER a local IP or localhost, because accounts.esn.org only allows registered public domains.
    let redirectUri: string;
    if (isLocal) {
      if (oauthConfig?.redirectUri && !this.isLocalUrl(oauthConfig.redirectUri)) {
        redirectUri = oauthConfig.redirectUri;
      } else {
        redirectUri = this.getPublicRedirectUri();
      }
    } else {
      redirectUri = oauthConfig?.redirectUri || `${window.location.origin}/auth`;
    }

    const authorizeUrl = oauthConfig?.authorizeUrl || 'https://accounts.esn.org/oauth/authorize';
    const scope = oauthConfig?.scope || 'oauth2_access_to_profile_information';

    const port = window.location.port || '8100';
    const localHost = window.location.port ? window.location.host : `${hostname}:${port}`;

    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    sessionStorage.setItem('oauth_verifier', codeVerifier);
    sessionStorage.setItem('oauth_redirect_uri', redirectUri);

    let state = this.generateRandomString(16);
    if (isLocal) {
      state = `local:${localHost}:${codeVerifier}`;
      sessionStorage.setItem('oauth_localhost', localHost);
    }

    const authUrl = `${authorizeUrl}?` +
      `response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}` +
      `&code_challenge=${encodeURIComponent(codeChallenge)}` +
      `&code_challenge_method=S256` +
      `&state=${encodeURIComponent(state)}`;

    window.location.href = authUrl;
  }

  public async loginWithOAuthCode(code: string, codeVerifier?: string, redirectUri?: string): Promise<User | null> {
    const effectiveRedirectUri =
      redirectUri && !this.isLocalUrl(redirectUri)
        ? redirectUri
        : (this.isLocalHost() ? this.getPublicRedirectUri() : redirectUri);

    const res: any = await this.api.postResource('login', {
      body: {
        code,
        codeVerifier,
        redirectUri: effectiveRedirectUri
      }
    });
    if (res?.token) {
      return await this.setToken(res.token);
    }
    throw new Error('Authentication failed: no token returned');
  }

  private generateRandomString(length = 64): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const randomValues = new Uint8Array(length);
      window.crypto.getRandomValues(randomValues);
      for (let i = 0; i < length; i++) {
        result += charset[randomValues[i] % charset.length];
      }
    } else {
      for (let i = 0; i < length; i++) {
        result += charset[Math.floor(Math.random() * charset.length)];
      }
    }
    return result;
  }

  private generateCodeVerifier(): string {
    return this.generateRandomString(64);
  }

  private async generateCodeChallenge(verifier: string): Promise<string> {
    if (typeof window !== 'undefined' && window.crypto?.subtle?.digest) {
      const encoder = new TextEncoder();
      const data = encoder.encode(verifier);
      const digest = await window.crypto.subtle.digest('SHA-256', data);
      return this.base64UrlEncode(digest);
    }
    // Fallback for non-secure contexts (e.g. HTTP over LAN IP like 192.168.*.* where window.crypto.subtle is undefined)
    const digest = this.fallbackSha256(verifier);
    return this.base64UrlEncode(digest);
  }

  private fallbackSha256(ascii: string): Uint8Array {
    function rightRotate(value: number, amount: number): number {
      return (value >>> amount) | (value << (32 - amount));
    }
    const mathPow = Math.pow;
    const maxWord = mathPow(2, 32);
    let i: number;
    let j: number;
    const words: number[] = [];
    const asciiBitLength = ascii.length * 8;
    let hash: number[] = [];
    const k: number[] = [];
    let primeCounter = 0;
    const isComposite: { [key: number]: number } = {};
    for (let candidate = 2; primeCounter < 64; candidate++) {
      if (!isComposite[candidate]) {
        for (i = 0; i < 313; i += candidate) {
          isComposite[i] = candidate;
        }
        hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
        k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      }
    }
    hash = hash.slice(0, 8);
    ascii += '\x80';
    while ((ascii.length % 64) - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) {
      j = ascii.charCodeAt(i);
      if (j >> 8) return new Uint8Array(32);
      words[i >> 2] |= j << ((3 - (i % 4)) * 8);
    }
    words[words.length] = (asciiBitLength / maxWord) | 0;
    words[words.length] = asciiBitLength | 0;
    for (j = 0; j < words.length; ) {
      const w = words.slice(j, (j += 16));
      const oldHash = hash;
      hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        const w15 = w[i - 15];
        const w2 = w[i - 2];
        const a = hash[0];
        const e = hash[4];
        const temp1 =
          hash[7] +
          (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
          ((e & hash[5]) ^ (~e & hash[6])) +
          k[i] +
          (w[i] =
            i < 16
              ? w[i]
              : (w[i - 16] +
                  (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                  w[i - 7] +
                  (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
                0);
        const temp2 =
          (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
          ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
      }
      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }
    const buffer = new Uint8Array(32);
    for (i = 0; i < 8; i++) {
      for (j = 3; j >= 0; j--) {
        buffer[i * 4 + (3 - j)] = (hash[i] >> (j * 8)) & 255;
      }
    }
    return buffer;
  }

  private base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
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

  public async loginWithGuestToken(guestToken: string): Promise<User | null> {
    const res: any = await this.api.getResource('login', {
      params: { guestToken },
      headers: { Accept: 'application/json' }
    });
    if (res?.token) {
      return await this.setToken(res.token);
    }
    throw new Error('Login failed: no token returned');
  }

  public getUserRoleKey(user?: User | null): string {
    const targetUser =
      this.isImpersonating && (!user || user.userId === this.originalUser?.userId)
        ? this.currentUser
        : (user || this.currentUser);

    if (!targetUser) return 'STANDARD_USER';
    if (targetUser.isGuest) return 'GUEST';
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
    if (targetUser.isGuest) return this.translate.instant('CONFIGURATIONS.GUEST_BADGE');
    if (targetUser.isAdministrator) return this.translate.instant('CONFIGURATIONS.ADMINISTRATOR');
    if (targetUser.isManager) return this.translate.instant('CONFIGURATIONS.MANAGER');
    if (targetUser.isAuditor) return this.translate.instant('CONFIGURATIONS.AUDITOR');
    if (targetUser.customRoleIds && targetUser.customRoleIds.length > 0) {
      return this.translate.instant('CONFIGURATIONS.CUSTOM_ROLE');
    }
    return this.translate.instant('CONFIGURATIONS.STANDARD_USER');
  }

  public hasElevatedRole(user?: User | null): boolean {
    const roleKey = this.getUserRoleKey(user);
    return roleKey !== 'STANDARD_USER';
  }
}
