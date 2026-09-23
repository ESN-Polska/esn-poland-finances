import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancialRequest, FinancialRequestStatus, RequestStatus } from '@models/financial-request.model';
import { AppPermission } from '@models/configurations.model';
import { RequestsService } from '../../../services/requests.service';
import { AppService } from '../../../app.service';
import { NavigationHistoryService } from '../../../services/navigation-history.service';

@Component({
  selector: 'app-request-view',
  templateUrl: './request-view.page.html',
  styleUrls: ['./request-view.page.scss']
})
export class RequestViewPage implements OnInit {
  public request?: FinancialRequest;
  public isLoading = true;
  public avatarError = false;

  public statusSteps: { key: FinancialRequestStatus; label: string }[] = [
    { key: 'SUBMITTED', label: 'REQUESTS.STATUSES.SUBMITTED' },
    { key: 'IN_REVIEW', label: 'REQUESTS.STATUSES.IN_REVIEW' },
    { key: 'APPROVED', label: 'REQUESTS.STATUSES.APPROVED' },
    { key: 'PAID', label: 'REQUESTS.STATUSES.PAID' }
  ];

  public get canManage(): boolean {
    const user = this.appService.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.isManager ||
      user.hasPermission(AppPermission.REQUESTS.PARENT) ||
      user.hasPermission(AppPermission.REQUESTS.MANAGE)
    );
  }

  public get canExport(): boolean {
    const user = this.appService.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.isManager ||
      user.isAuditor ||
      user.hasPermission(AppPermission.REQUESTS.PARENT) ||
      user.hasPermission(AppPermission.REQUESTS.EXPORT)
    );
  }

  public get canViewAll(): boolean {
    const user = this.appService.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.isManager ||
      user.isAuditor ||
      user.hasPermission(AppPermission.REQUESTS.VIEW_ALL) ||
      user.hasPermission(AppPermission.REQUESTS.MANAGE) ||
      user.hasPermission(AppPermission.REQUESTS.PARENT)
    );
  }

  public get isAuditorOnly(): boolean {
    const user = this.appService.currentUser;
    if (!user) return false;
    return user.isAuditor && !user.isAdministrator && !user.isManager && !user.hasPermission(AppPermission.REQUESTS.MANAGE);
  }

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private requestsService: RequestsService,
    private navHistory: NavigationHistoryService,
    public appService: AppService
  ) {}

  public async ngOnInit(): Promise<void> {
    const year = this.route.snapshot.paramMap.get('year');
    const id = this.route.snapshot.paramMap.get('id');
    let requestId: string | null = null;

    if (year && id) {
      requestId = `${id}/${year}`;
    } else if (id) {
      requestId = decodeURIComponent(id);
    }

    if (!requestId) {
      this.router.navigate(['/t/requests']);
      return;
    }
    await this.loadRequest(requestId);
  }

  public async loadRequest(requestId: string): Promise<void> {
    this.isLoading = true;
    try {
      const found = await this.requestsService.getRequestById(requestId);
      if (!found) {
        await this.showToast('REQUESTS.NOT_FOUND', 'danger');
        this.router.navigate(['/t/requests']);
        return;
      }

      const currentUser = this.appService.currentUser;
      const isOwner = (found.userId || '').toLowerCase() === (currentUser?.userId || '').toLowerCase();
      if (!this.canViewAll && !isOwner) {
        await this.showToast('REQUESTS.ACCESS_DENIED', 'danger');
        this.router.navigate(['/t/requests']);
        return;
      }

      this.request = found;
    } catch (err: any) {
      console.error('Failed to load request', err);
      if (err?.message?.includes('Access denied') || err?.status === 403 || err?.statusCode === 403) {
        await this.showToast('REQUESTS.ACCESS_DENIED', 'danger');
      } else {
        await this.showToast('REQUESTS.LOAD_ERROR', 'danger');
      }
      this.router.navigate(['/t/requests']);
    } finally {
      this.isLoading = false;
    }
  }

  public openAccountsProfile(userId?: string): void {
    if (userId) {
      window.open(`https://accounts.esn.org/user/${encodeURIComponent(userId)}`, '_blank', 'noopener,noreferrer');
    }
  }

  public getSubmitterSection(): string {
    if (!this.request) return '';
    if (typeof this.request.getSectionOrCountry === 'function') {
      return this.request.getSectionOrCountry();
    }
    const section = this.request.section?.trim();
    if (section && section !== 'undefined') {
      return section;
    }
    const country = this.request.country?.trim();
    if (country && country !== 'undefined') {
      return `ESN ${country}`;
    }
    return '';
  }

  public canEdit(): boolean {
    return !!this.request && (this.request.status === 'DRAFT' || this.request.status === 'CHANGES_REQUESTED');
  }

  public editRequest(): void {
    if (!this.request || !this.canEdit()) return;
    const [seq, year] = this.request.requestId.split('/');
    if (year && seq) {
      this.router.navigate(['/t/requests/edit', year, seq]);
    } else {
      this.router.navigate(['/t/requests/edit', encodeURIComponent(this.request.requestId)]);
    }
  }

  public async confirmDeleteDraft(): Promise<void> {
    if (!this.request || this.request.status !== 'DRAFT') return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('REQUESTS.DELETE_CONFIRM_HEADER') || 'Delete Draft',
      message: this.translate.instant('REQUESTS.DELETE_CONFIRM_MSG') || 'Are you sure you want to delete this draft?',
      buttons: [
        {
          text: this.translate.instant('COMMON.CANCEL') || 'Cancel',
          role: 'cancel'
        },
        {
          text: this.translate.instant('COMMON.DELETE') || 'Delete',
          role: 'destructive',
          handler: async () => {
            await this.requestsService.deleteDraft(this.request!.requestId);
            await this.showToast('REQUESTS.DELETE_SUCCESS', 'success');
            this.router.navigate(['/t/requests'], { replaceUrl: true });
          }
        }
      ]
    });

    await alert.present();
  }

  public getStepStatus(stepKey: FinancialRequestStatus): 'active' | 'completed' | 'pending' | 'rejected' {
    if (!this.request) return 'pending';
    const current = this.request.status;

    if (current === 'REJECTED') {
      return stepKey === 'SUBMITTED' ? 'completed' : 'rejected';
    }

    const order: FinancialRequestStatus[] = ['DRAFT', 'CHANGES_REQUESTED', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PAID'];
    const currentIndex = order.indexOf(current);
    const stepIndex = order.indexOf(stepKey);

    if (currentIndex === stepIndex) return 'active';
    if (currentIndex > stepIndex) return 'completed';
    return 'pending';
  }

  public goBack(): void {
    const fallback = this.canManage ? '/t/requests/manage' : '/t/requests';
    this.navHistory.goBack(fallback);
  }

  public exportCurrentRequest(): void {
    if (!this.request || !this.canExport) return;
    this.requestsService.exportToCsv([this.request], `request-${this.request.displayId.replace(/[\/\\?%*:|"<>]/g, '_')}.csv`);
    this.showToast('REQUESTS.MANAGE_PANEL.EXPORT_SUCCESS', 'success');
  }

  public goToReview(): void {
    if (!this.request || !this.canManage) return;
    const [seq, year] = this.request.requestId.split('/');
    if (year && seq) {
      this.router.navigate(['/t/requests/review', year, seq]);
    } else {
      this.router.navigate(['/t/requests/review', encodeURIComponent(this.request.requestId)]);
    }
  }

  private async showToast(messageKey: string, color: string): Promise<void> {
    const msg = this.translate.instant(messageKey);
    const toast = await this.toastCtrl.create({
      message: msg && msg !== messageKey ? msg : messageKey,
      duration: 3500,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
