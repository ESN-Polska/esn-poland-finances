import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancialRequest, FinancialRequestStatus, RequestStatus } from '@models/financial-request.model';
import { AppPermission, UsersOriginDisplayOptions } from '@models/configurations.model';
import { RequestsService } from '../../../services/requests.service';
import { AppService } from '../../../app.service';
import { NavigationHistoryService } from '../../../services/navigation-history.service';

@Component({
  selector: 'app-request-review',
  templateUrl: './request-review.page.html',
  styleUrls: ['./request-review.page.scss']
})
export class RequestReviewPage implements OnInit {
  public request?: FinancialRequest;
  public isLoading = true;
  public isUpdatingStatus = false;
  public avatarError = false;
  public copiedField: string | null = null;

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
      this.router.navigate(['/t/requests/manage']);
      return;
    }

    // Permission guard: only managers and administrators can review
    if (!this.canManage) {
      await this.showToast('REQUESTS.REVIEW_PANEL.UNAUTHORIZED_REDIRECT', 'warning');
      this.navigateToView(requestId);
      return;
    }

    await this.loadRequestAndInitializeReview(requestId);
  }

  private async loadRequestAndInitializeReview(requestId: string): Promise<void> {
    this.isLoading = true;
    try {
      const found = await this.requestsService.getRequestById(requestId);
      if (!found) {
        await this.showToast('REQUESTS.NOT_FOUND', 'danger');
        this.router.navigate(['/t/requests/manage']);
        return;
      }

      this.request = found;

      // Automatically mark as IN_REVIEW if the request is SUBMITTED
      if (this.request.status === 'SUBMITTED') {
        await this.autoMarkInReview();
      }
    } catch (err: any) {
      console.error('Failed to load request for review', err);
      if (err?.message?.includes('Access denied') || err?.status === 403 || err?.statusCode === 403) {
        await this.showToast('REQUESTS.ACCESS_DENIED', 'danger');
        this.router.navigate(['/t/requests']);
      } else {
        await this.showToast('REQUESTS.LOAD_ERROR', 'danger');
        this.router.navigate(['/t/requests/manage']);
      }
    } finally {
      this.isLoading = false;
    }
  }

  private async autoMarkInReview(): Promise<void> {
    if (!this.request || this.request.status !== 'SUBMITTED' || !this.canManage) return;

    try {
      const comment = 'REQUESTS.HISTORY_COMMENTS.IN_REVIEW';
      const updated = await this.requestsService.updateRequestStatus(
        this.request.requestId,
        'IN_REVIEW',
        comment
      );
      this.request = updated;
      await this.showToast('REQUESTS.REVIEW_PANEL.AUTO_IN_REVIEW_SUCCESS', 'primary');
    } catch (err) {
      console.error('Failed to auto-transition request to IN_REVIEW', err);
    }
  }

  public navigateToView(requestId?: string): void {
    const idToUse = requestId || this.request?.requestId;
    if (!idToUse) {
      this.router.navigate(['/t/requests']);
      return;
    }
    const [seq, year] = idToUse.split('/');
    if (year && seq) {
      this.router.navigate(['/t/requests/view', year, seq]);
    } else {
      this.router.navigate(['/t/requests/view', encodeURIComponent(idToUse)]);
    }
  }

  public goBack(): void {
    this.navHistory.goBack('/t/requests/manage');
  }

  public openAccountsProfile(userId?: string): void {
    if (userId) {
      window.open(`https://accounts.esn.org/user/${encodeURIComponent(userId)}`, '_blank', 'noopener,noreferrer');
    }
  }

  public getSubmitterSection(): string {
    if (!this.request) return '';
    const displayOption = this.appService.configurations?.usersOriginDisplay || UsersOriginDisplayOptions.BOTH;
    if (typeof this.request.getOrigin === 'function') {
      const origin = this.request.getOrigin(displayOption);
      if (origin) return origin;
    }
    if (typeof this.request.getSectionOrCountry === 'function') {
      return this.request.getSectionOrCountry(displayOption);
    }
    const cleanSection = this.request.section?.trim();
    const cleanCountry = this.request.country?.trim();
    if (displayOption === UsersOriginDisplayOptions.COUNTRY) return cleanCountry || '';
    if (displayOption === UsersOriginDisplayOptions.SECTION) return cleanSection || '';
    if (cleanCountry && cleanSection) {
      if (cleanCountry === cleanSection) return cleanSection;
      return `${cleanCountry} - ${cleanSection}`;
    }
    return cleanSection || cleanCountry || '';
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

  public exportCurrentRequest(): void {
    if (!this.request || !this.canExport) return;
    this.requestsService.exportToCsv(
      [this.request],
      `request-review-${this.request.displayId.replace(/[\/\\?%*:|"<>]/g, '_')}.csv`
    );
    this.showToast('REQUESTS.MANAGE_PANEL.EXPORT_SUCCESS', 'success');
  }

  public openAttachment(attachment: any): void {
    if (!attachment) return;
    if (attachment.url) {
      window.open(attachment.url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (attachment.s3Key) {
      const url = `https://media.finances.esn-poland.link/${attachment.s3Key.replace(/^\/+/, '')}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  public async copyToClipboard(text?: string, fieldName = ''): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copiedField = fieldName;
      setTimeout(() => {
        if (this.copiedField === fieldName) this.copiedField = null;
      }, 2000);
      this.showToast('COMMON.COPY_SUCCESS', 'medium');
    } catch {
      // Fallback
    }
  }

  // --- Manager Decision Actions ---

  public async promptApprove(): Promise<void> {
    if (!this.request || !this.canManage) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('REQUESTS.MANAGE_PANEL.APPROVE_HEADER') || 'Approve Request',
      message: `${this.translate.instant('REQUESTS.MANAGE_PANEL.APPROVE_CONFIRM')} ${this.request.displayId}?`,
      inputs: [
        {
          name: 'comment',
          type: 'text',
          placeholder: this.translate.instant('REQUESTS.MANAGE_PANEL.OPTIONAL_COMMENT') || 'Optional approval note'
        }
      ],
      buttons: [
        {
          text: this.translate.instant('COMMON.CANCEL') || 'Cancel',
          role: 'cancel'
        },
        {
          text: this.translate.instant('REQUESTS.STATUSES.APPROVED') || 'Approve',
          handler: async (data) => {
            const comment = (data.comment || '').trim();
            await this.executeStatusChange('APPROVED', comment || 'REQUESTS.HISTORY_COMMENTS.REQUEST_APPROVED');
          }
        }
      ]
    });
    await alert.present();
  }

  public async promptRequestChanges(): Promise<void> {
    if (!this.request || !this.canManage) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('REQUESTS.MANAGE_PANEL.REQUEST_CHANGES_HEADER') || 'Request Changes',
      message: this.translate.instant('REQUESTS.MANAGE_PANEL.REQUEST_CHANGES_DESC') || 'Provide clear instructions for what needs to be changed by the applicant:',
      inputs: [
        {
          name: 'remarks',
          type: 'textarea',
          placeholder: this.translate.instant('REQUESTS.MANAGE_PANEL.REQUIRED_CHANGES_PLACEHOLDER') || 'Explain required modifications...'
        }
      ],
      buttons: [
        {
          text: this.translate.instant('COMMON.CANCEL') || 'Cancel',
          role: 'cancel'
        },
        {
          text: this.translate.instant('REQUESTS.MANAGE_PANEL.SEND_REQUEST_CHANGES') || 'Request Changes',
          handler: async (data) => {
            const remarks = (data.remarks || '').trim();
            if (!remarks) {
              this.showToast('REQUESTS.MANAGE_PANEL.REMARKS_REQUIRED', 'warning');
              return false;
            }
            await this.executeStatusChange('CHANGES_REQUESTED', remarks, remarks);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  public async promptMarkPaid(): Promise<void> {
    if (!this.request || !this.canManage) return;

    const amountDisplay = this.request.isMixedCurrency?.()
      ? `${this.request.getGrossAmountPLN()} PLN + ${this.request.getGrossAmountEUR()} EUR`
      : `${this.request.totalGrossAmount} ${this.request.currency}`;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('REQUESTS.MANAGE_PANEL.MARK_PAID_HEADER') || 'Mark as Paid',
      message: `${this.translate.instant('REQUESTS.MANAGE_PANEL.MARK_PAID_CONFIRM')} ${this.request.displayId} (${amountDisplay})?`,
      inputs: [
        {
          name: 'comment',
          type: 'text',
          placeholder: this.translate.instant('REQUESTS.MANAGE_PANEL.OPTIONAL_PAYMENT_REF') || 'Optional transfer reference / note'
        }
      ],
      buttons: [
        {
          text: this.translate.instant('COMMON.CANCEL') || 'Cancel',
          role: 'cancel'
        },
        {
          text: this.translate.instant('REQUESTS.STATUSES.PAID') || 'Mark Paid',
          handler: async (data) => {
            const comment = (data.comment || '').trim();
            await this.executeStatusChange('PAID', comment || 'REQUESTS.HISTORY_COMMENTS.PAYOUT_COMPLETED');
          }
        }
      ]
    });
    await alert.present();
  }

  public async promptReject(): Promise<void> {
    if (!this.request || !this.canManage) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('REQUESTS.MANAGE_PANEL.REJECT_HEADER') || 'Reject Request',
      message: this.translate.instant('REQUESTS.MANAGE_PANEL.REJECT_DESC') || 'Provide the rejection reason for the applicant:',
      inputs: [
        {
          name: 'reason',
          type: 'textarea',
          placeholder: this.translate.instant('REQUESTS.MANAGE_PANEL.REJECTION_REASON_PLACEHOLDER') || 'Enter rejection reason...'
        }
      ],
      buttons: [
        {
          text: this.translate.instant('COMMON.CANCEL') || 'Cancel',
          role: 'cancel'
        },
        {
          text: this.translate.instant('REQUESTS.STATUSES.REJECTED') || 'Reject',
          role: 'destructive',
          handler: async (data) => {
            const reason = (data.reason || '').trim();
            if (!reason) {
              this.showToast('REQUESTS.MANAGE_PANEL.REASON_REQUIRED', 'warning');
              return false;
            }
            await this.executeStatusChange('REJECTED', reason, reason);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async executeStatusChange(
    newStatus: RequestStatus,
    comment?: string,
    adminRemarks?: string
  ): Promise<void> {
    if (!this.request) return;
    this.isUpdatingStatus = true;
    try {
      const updated = await this.requestsService.updateRequestStatus(
        this.request.requestId,
        newStatus,
        comment,
        adminRemarks
      );
      this.request = updated;
      await this.showToast('REQUESTS.MANAGE_PANEL.STATUS_UPDATED', 'success');
    } catch (err: any) {
      this.showToast(err.message || 'Error updating status', 'danger');
    } finally {
      this.isUpdatingStatus = false;
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
