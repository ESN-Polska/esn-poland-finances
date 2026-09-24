import { Component, Input, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActionSheetController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { environment as env } from '@env';
import { AppService } from '../app.service';

@Component({
  selector: 'app-auth',
  templateUrl: './auth.page.html',
  styleUrls: ['./auth.page.scss']
})
export class AuthPage implements OnInit {
  @Input() token?: string;

  public isProcessing = false;
  public isGuestLogin = false;
  public guestErrorKey: string | null = null;

  public get isAppLocked(): boolean {
    return !!this.appService.configurations?.appLocked;
  }

  public get appLockMessage(): string {
    return (
      this.appService.configurations?.getAppLockMessage(this.appService.currentLanguage) ||
      this.translate.instant('AUTH.APP_LOCKED_TITLE')
    );
  }

  public get guestErrorNotice(): string | null {
    return this.guestErrorKey ? this.translate.instant(this.guestErrorKey) : null;
  }
  public get supportEmail(): string {
    return this.appService.configurations?.supportEmail?.trim() || '';
  }
  public version = env.idea?.app?.version || '1.0.0';

  constructor(
    public appService: AppService,
    private actionSheetCtrl: ActionSheetController,
    private route: ActivatedRoute,
    private router: Router,
    private toastCtrl: ToastController,
    private translate: TranslateService
  ) {}

  public async openSupportContact(): Promise<void> {
    const email = this.supportEmail;
    if (!email) return;

    const actionSheet = await this.actionSheetCtrl.create({
      header: this.translate.instant('SUPPORT.TITLE'),
      subHeader: email,
      buttons: [
        {
          text: this.translate.instant('SUPPORT.ACTION_SEND'),
          icon: 'mail-outline',
          handler: () => {
            const appTitle = this.appService.configurations?.getAppTitle(this.appService.currentLanguage) || 'ESN Finances';
            const context = this.guestErrorKey
              ? 'Guest Invitation Issue'
              : (this.isAppLocked ? 'Application Locked Inquiry' : 'Support Request');
            const subject = encodeURIComponent(`[${appTitle}] ${context}`);
            window.location.href = `mailto:${email}?subject=${subject}`;
          }
        },
        {
          text: this.translate.instant('SUPPORT.ACTION_COPY'),
          icon: 'copy-outline',
          handler: () => {
            if (navigator?.clipboard?.writeText) {
              navigator.clipboard.writeText(email).then(() => {
                this.showToast('SUPPORT.EMAIL_COPIED', 'success');
              }).catch(() => {
                this.showToast('SUPPORT.EMAIL_COPIED', 'success');
              });
            } else {
              this.showToast('SUPPORT.EMAIL_COPIED', 'success');
            }
          }
        },
        {
          text: this.translate.instant('COMMON.CANCEL'),
          icon: 'close-outline',
          role: 'cancel'
        }
      ]
    });
    await actionSheet.present();
  }

  public async ngOnInit(): Promise<void> {
    await this.appService.init();

    // Check for error parameters (e.g. redirected from backend when app is locked)
    const queryError = this.route.snapshot.queryParamMap.get('error');
    if (queryError === 'app_locked') {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('AUTH.APP_LOCKED_NON_ADMIN_ERROR'),
        duration: 5000,
        color: 'warning',
        position: 'bottom'
      });
      await toast.present();
    }

    // Check for OAuth error returned by ESN Accounts
    const oauthError = this.route.snapshot.queryParamMap.get('error');
    if (oauthError && oauthError !== 'app_locked') {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('AUTH.LOGIN_FAILED'),
        duration: 5000,
        color: 'danger',
        position: 'bottom'
      });
      await toast.present();
    }

    // Check token from @Input (routed parameter) or snapshot queryParams
    const queryToken = this.token || this.route.snapshot.queryParamMap.get('token');
    const guestToken = this.route.snapshot.queryParamMap.get('guestToken');
    const code = this.route.snapshot.queryParamMap.get('code');
    const state = this.route.snapshot.queryParamMap.get('state');

    if (code) {
      // If returning to dev callback from a localhost session, bounce to localhost
      if (
        state &&
        state.startsWith('local:') &&
        typeof window !== 'undefined' &&
        !this.appService.isLocalHost(window.location.hostname)
      ) {
        const raw = state.replace('local:', '');
        const lastColon = raw.lastIndexOf(':');
        let localTarget = raw;
        let verifierFromState = '';
        if (lastColon !== -1 && raw.length - lastColon - 1 >= 32) {
          localTarget = raw.substring(0, lastColon);
          verifierFromState = raw.substring(lastColon + 1);
        }
        const verifier =
          verifierFromState ||
          sessionStorage.getItem('oauth_verifier') ||
          '';
        window.location.href = `http://${localTarget}/auth?code=${encodeURIComponent(code)}&v=${encodeURIComponent(verifier)}`;
        return;
      }

      this.isProcessing = true;
      try {
        const codeVerifier =
          this.route.snapshot.queryParamMap.get('v') ||
          sessionStorage.getItem('oauth_verifier') ||
          undefined;
        let redirectUri = sessionStorage.getItem('oauth_redirect_uri') || undefined;
        if (!redirectUri || (this.appService.isLocalHost() && this.appService.isLocalUrl(redirectUri))) {
          redirectUri = this.appService.getPublicRedirectUri();
        }

        await this.appService.loginWithOAuthCode(code, codeVerifier, redirectUri);
        sessionStorage.removeItem('oauth_verifier');
        sessionStorage.removeItem('oauth_redirect_uri');
        sessionStorage.removeItem('oauth_localhost');
        await this.router.navigate(['/'], { replaceUrl: true });
        return;
      } catch (err: any) {
        console.error('Failed to process OAuth code authentication', err);
        this.isProcessing = false;
        sessionStorage.removeItem('oauth_verifier');
        sessionStorage.removeItem('oauth_redirect_uri');
        sessionStorage.removeItem('oauth_localhost');
        await this.router.navigate([], { replaceUrl: true, queryParams: {} });

        const rawErr =
          err?.error?.message ||
          err?.error?.error ||
          (typeof err?.error === 'string' ? err.error : '') ||
          err?.message ||
          '';
        const isLockedErr =
          err?.status === 403 ||
          String(rawErr).toLowerCase().includes('locked');

        const toast = await this.toastCtrl.create({
          message: this.translate.instant(
            isLockedErr ? 'AUTH.APP_LOCKED_NON_ADMIN_ERROR' : 'AUTH.LOGIN_FAILED'
          ),
          duration: 5000,
          color: isLockedErr ? 'warning' : 'danger',
          position: 'bottom'
        });
        await toast.present();
      }
    } else if (guestToken) {
      if (this.isAppLocked) {
        return;
      }
      this.isGuestLogin = true;
      this.isProcessing = true;
      try {
        await this.appService.loginWithGuestToken(guestToken);
        await this.router.navigate(['/t/requests/submit'], { replaceUrl: true });
        return;
      } catch (err: any) {
        console.error('Failed to process guest authentication', err);
        this.isProcessing = false;
        const rawErr =
          err?.error?.message ||
          err?.error?.error ||
          (typeof err?.error === 'string' ? err.error : '') ||
          err?.message ||
          '';
        const msg = String(rawErr).toLowerCase();

        if (msg.includes('revoked')) {
          this.guestErrorKey = 'AUTH.GUEST_ERROR_REVOKED';
        } else if (msg.includes('expired')) {
          this.guestErrorKey = 'AUTH.GUEST_ERROR_EXPIRED';
        } else if (msg.includes('used') || msg.includes('already')) {
          this.guestErrorKey = 'AUTH.GUEST_ERROR_USED';
        } else if (msg.includes('disabled')) {
          this.guestErrorKey = 'AUTH.GUEST_ERROR_DISABLED';
        } else {
          this.guestErrorKey = 'AUTH.GUEST_ERROR_INVALID';
        }
      }
    } else if (queryToken) {
      this.isProcessing = true;
      try {
        await this.appService.setToken(queryToken);
        await this.router.navigate(['/'], { replaceUrl: true });
      } catch (err) {
        console.error('Failed to process authentication token', err);
        this.isProcessing = false;
      }
    } else if (this.appService.isAuthenticated) {
      if (!this.appService.realUser?.isAdministrator) {
        const isLocked = await this.appService.checkAppLockForCurrentUser();
        if (isLocked) {
          return;
        }
      }
      await this.router.navigate(['/'], { replaceUrl: true });
    }
  }

  public get currentLang(): string {
    return this.appService.currentLanguage;
  }

  public setLang(lang: string): void {
    this.appService.setLanguage(lang);
  }

  public login(): void {
    this.isProcessing = true;
    this.appService.startLoginFlow();
  }

  private async showToast(messageKey: string, color: string): Promise<void> {
    const msg = this.translate.instant(messageKey);
    const toast = await this.toastCtrl.create({
      message: msg && msg !== messageKey ? msg : messageKey,
      duration: 3000,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
