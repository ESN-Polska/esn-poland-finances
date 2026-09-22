import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { LoadingController, ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancialRequest } from '@models/financial-request.model';
import { AppPermission, Configurations, DEFAULT_CONFIGURATIONS, UsersOriginDisplayOptions } from '@models/configurations.model';
import { User } from '@models/user.model';
import { RequestsService } from '../../services/requests.service';
import { AppService } from '../../app.service';
import { ConfigurationsService } from '../configurations/configurations.service';
import { UsersService } from '../../common/users.service';
import { HomeTextModalComponent } from './homeTextModal.component';
import { HomeNoticeModalComponent } from './homeNoticeModal.component';

@Component({
  selector: 'app-home-tab',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss']
})
export class HomePage implements OnInit {
  public latestRequest: FinancialRequest | null = null;
  public isLoading = true;

  public accessedUsers: User[] = [];
  public filteredAccessedUsers: User[] = [];
  public usersSearchQuery = '';
  public isLoadingUsers = false;

  constructor(
    public app: AppService,
    private router: Router,
    private requestsService: RequestsService,
    private configurationsService: ConfigurationsService,
    private usersService: UsersService,
    private modalCtrl: ModalController,
    private loadingCtrl: LoadingController,
    private translate: TranslateService
  ) {}

  public get welcomeTitle(): string {
    const lang = (this.translate.currentLang as 'en' | 'pl') || 'en';
    return (
      this.app.configurations?.getHomeWelcomeTitle(lang) ||
      DEFAULT_CONFIGURATIONS.homeWelcomeTitle[lang] ||
      DEFAULT_CONFIGURATIONS.homeWelcomeTitle.en
    );
  }

  public get welcomeSubtitle(): string {
    const lang = (this.translate.currentLang as 'en' | 'pl') || 'en';
    return (
      this.app.configurations?.getHomeWelcomeSubtitle(lang) ||
      DEFAULT_CONFIGURATIONS.homeWelcomeSubtitle[lang] ||
      DEFAULT_CONFIGURATIONS.homeWelcomeSubtitle.en
    );
  }

  public get isNoticeActive(): boolean {
    return this.app.configurations?.isHomeNoticeActive() || false;
  }

  public get noticeType(): string {
    return this.app.configurations?.homeNotice?.type || 'info';
  }

  public get noticeText(): string {
    return this.app.configurations?.getHomeNoticeText(this.translate.currentLang) || '';
  }

  public canEditHomeText(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditor) return false;
    return user.hasPermission(AppPermission.HOME.TEXT);
  }

  public canEditHomeNotice(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator) return true;
    if (user.isAuditor) return false;
    return user.hasPermission(AppPermission.HOME.NOTICE);
  }

  public canViewStatistics(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    if (user.isAdministrator || user.isAuditor) return true;
    return user.hasPermission(AppPermission.HOME.STATISTICS);
  }

  public async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  public async ionViewWillEnter(): Promise<void> {
    await this.loadData();
  }

  public async loadData(): Promise<void> {
    await Promise.all([
      this.loadRecentActivity(),
      this.loadAccessStatistics()
    ]);
  }

  public async loadRecentActivity(): Promise<void> {
    this.isLoading = true;
    try {
      this.latestRequest = await this.requestsService.getLatestRequest();
    } catch (err) {
      console.error('Failed to load recent activity', err);
    } finally {
      this.isLoading = false;
    }
  }

  public async loadAccessStatistics(): Promise<void> {
    if (!this.canViewStatistics()) return;
    this.isLoadingUsers = true;
    try {
      const users = await this.usersService.getAll();

      // Also include guest invitations that have accessed/submitted or have lastAccessedAt
      const guestUsersFromInvites: User[] = [];
      const existingUserIds = new Set((users || []).map(u => u.userId));

      for (const inv of this.app.configurations?.guestInvitations || []) {
        const accessTime = inv.lastAccessedAt || inv.submittedAt;
        const guestUserId = `guest_${inv.id.replace(/-/g, '').slice(0, 10)}`;
        if (accessTime && !existingUserIds.has(guestUserId)) {
          guestUsersFromInvites.push(
            new User({
              userId: guestUserId,
              email: inv.guestEmail,
              firstName: inv.guestName,
              lastName: '',
              isGuest: true,
              guestInvitationId: inv.id,
              guestPurpose: inv.purpose,
              guestPosition: inv.position,
              lastLoginAt: accessTime
            })
          );
        }
      }

      const allUsers = [...(users || []), ...guestUsersFromInvites];
      this.accessedUsers = allUsers
        .filter(u => !!u.lastLoginAt)
        .map(u => {
          if (this.app.configurations) {
            User.applyConfigurationPermissions(u, this.app.configurations);
          }
          return u;
        })
        .sort((a, b) => new Date(b.lastLoginAt).getTime() - new Date(a.lastLoginAt).getTime());
      this.applyUsersFilter();
    } catch (err) {
      console.error('Failed to load user access statistics', err);
    } finally {
      this.isLoadingUsers = false;
    }
  }

  public applyUsersFilter(): void {
    const query = this.usersSearchQuery.trim().toLowerCase();
    if (!query) {
      this.filteredAccessedUsers = [...this.accessedUsers];
      return;
    }
    this.filteredAccessedUsers = this.accessedUsers.filter(u =>
      u.getDisplayName().toLowerCase().includes(query) ||
      u.userId.toLowerCase().includes(query) ||
      (u.email || '').toLowerCase().includes(query) ||
      (u.section || '').toLowerCase().includes(query) ||
      (u.country || '').toLowerCase().includes(query) ||
      (u.guestPurpose || '').toLowerCase().includes(query) ||
      (u.guestPosition || '').toLowerCase().includes(query) ||
      (u.isGuest && ('guest'.includes(query) || 'gość'.includes(query)))
    );
  }

  public formatLoginDate(isoDate: string): string {
    if (!isoDate) return '';
    try {
      const d = new Date(isoDate);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${dd}.${mm}.${yyyy}, ${hh}:${min}`;
    } catch {
      return isoDate;
    }
  }

  public getUserOrigin(user: User): string {
    if (user.isGuest) {
      return user.guestPosition?.trim() || this.translate.instant('CONFIGURATIONS.GUEST_BADGE');
    }
    return user.getOrigin() || '';
  }

  public async editHomeText(): Promise<void> {
    if (!this.canEditHomeText()) return;

    const modal = await this.modalCtrl.create({
      component: HomeTextModalComponent,
      componentProps: {
        currentTitle: this.app.configurations?.homeWelcomeTitle,
        currentSubtitle: this.app.configurations?.homeWelcomeSubtitle
      }
    });
    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data?.title && data?.subtitle) {
      const updated = new Configurations(this.app.configurations);
      updated.homeWelcomeTitle = data.title;
      updated.homeWelcomeSubtitle = data.subtitle;
      await this.saveConfigurations(updated);
    }
  }

  public async editHomeNotice(): Promise<void> {
    if (!this.canEditHomeNotice()) return;

    const modal = await this.modalCtrl.create({
      component: HomeNoticeModalComponent,
      componentProps: {
        currentNotice: this.app.configurations?.homeNotice
      }
    });
    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data?.notice) {
      const updated = new Configurations(this.app.configurations);
      updated.homeNotice = data.notice;
      await this.saveConfigurations(updated);
    }
  }

  private async saveConfigurations(updated: Configurations): Promise<void> {
    const loading = await this.loadingCtrl.create({ message: this.translate.instant('COMMON.SAVING') });
    await loading.present();
    try {
      const saved = await this.configurationsService.update(updated);
      this.app.configurations = saved;
      if (this.app.currentUser && !this.app.isImpersonating) {
        User.applyConfigurationPermissions(this.app.currentUser, this.app.configurations);
      }
    } catch (err) {
      console.error('Failed to save configurations', err);
    } finally {
      await loading.dismiss();
    }
  }

  public goToSubmit(): void {
    this.router.navigate(['/t/requests/submit']);
  }

  public viewRequest(requestId: string): void {
    const [seq, year] = requestId.split('/');
    if (year && seq) {
      this.router.navigate(['/t/requests/view', year, seq]);
    } else {
      this.router.navigate(['/t/requests/view', encodeURIComponent(requestId)]);
    }
  }
}
