import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancialRequest, FinancialRequestStatus } from '@models/financial-request.model';
import { RequestsService } from '../../../services/requests.service';

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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private requestsService: RequestsService
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
      this.request = found;
    } catch (err) {
      console.error('Failed to load request', err);
      await this.showToast('REQUESTS.LOAD_ERROR', 'danger');
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
    this.router.navigate(['/t/requests']);
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
