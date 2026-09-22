import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import {
  FinancialRequest,
  FinancialRequestType,
  RequestStatus
} from '@models/financial-request.model';
import { AppPermission } from '@models/configurations.model';
import { RequestsService } from '../../../services/requests.service';
import { AppService } from '../../../app.service';

@Component({
  selector: 'app-manage-requests',
  templateUrl: './manage-requests.page.html',
  styleUrls: ['./manage-requests.page.scss']
})
export class ManageRequestsPage implements OnInit {
  public allRequests: FinancialRequest[] = [];
  public filteredRequests: FinancialRequest[] = [];
  public isLoading = false;

  public currentYear = new Date().getFullYear();

  // Filter state
  public searchQuery = '';
  public selectedStatus: string = 'ALL';
  public selectedType: string = 'ALL';
  public selectedYear: string = new Date().getFullYear().toString();
  public availableYears: number[] = [];

  public readonly allStatuses: RequestStatus[] = [
    'SUBMITTED',
    'IN_REVIEW',
    'CHANGES_REQUESTED',
    'APPROVED',
    'PAID',
    'REJECTED'
  ];

  public readonly allTypes: FinancialRequestType[] = [
    'INVOICE_TO_PAY',
    'INVOICE_REIMBURSEMENT',
    'ADVANCE_PAYMENT',
    'DELEGATION_SETTLEMENT'
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

  public get canAccessManage(): boolean {
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

  // Summary Metrics scoped to active filter criteria
  public get baseFilteredRequests(): FinancialRequest[] {
    return this.allRequests.filter((req) => this.matchesBaseFilters(req));
  }

  public get pendingCount(): number {
    return this.baseFilteredRequests.filter((r) => r.status === 'SUBMITTED').length;
  }

  public get inReviewCount(): number {
    return this.baseFilteredRequests.filter((r) => r.status === 'IN_REVIEW').length;
  }

  public get changesRequestedCount(): number {
    return this.baseFilteredRequests.filter((r) => r.status === 'CHANGES_REQUESTED').length;
  }

  public get approvedCount(): number {
    return this.baseFilteredRequests.filter((r) => r.status === 'APPROVED').length;
  }

  public get paidCount(): number {
    return this.baseFilteredRequests.filter((r) => r.status === 'PAID').length;
  }

  public get totalApprovedAmountPLN(): number {
    const targetRequests =
      this.selectedStatus === 'ALL'
        ? this.baseFilteredRequests.filter((r) => r.status === 'APPROVED' || r.status === 'PAID')
        : this.filteredRequests.filter((r) => r.status === 'APPROVED' || r.status === 'PAID');

    const sum = targetRequests.reduce((acc, r) => acc + (Number(r.totalGrossAmount) || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  constructor(
    private router: Router,
    private alertCtrl: AlertController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private requestsService: RequestsService,
    public appService: AppService
  ) {}

  public async ngOnInit(): Promise<void> {
    if (!this.canAccessManage) {
      await this.showToast('REQUESTS.ACCESS_DENIED', 'danger');
      this.router.navigate(['/t/requests']);
      return;
    }
    await this.loadRequests();
  }

  public async ionViewWillEnter(): Promise<void> {
    if (!this.canAccessManage) {
      this.router.navigate(['/t/requests']);
      return;
    }
    await this.loadRequests();
  }

  public async loadRequests(): Promise<void> {
    this.isLoading = true;
    try {
      const loaded = await this.requestsService.loadAllRequests();
      this.allRequests = (loaded || []).filter((r) => r.status !== 'DRAFT');
      this.extractAvailableYears();
      this.applyFilters();
    } catch (err) {
      console.error('Failed to load requests for management', err);
      this.showToast('REQUESTS.LOAD_ERROR', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  private extractAvailableYears(): void {
    const yearsSet = new Set<number>();
    for (const r of this.allRequests) {
      if (r.year) yearsSet.add(r.year);
      else if (r.createdAt) yearsSet.add(new Date(r.createdAt).getFullYear());
    }
    const currentYear = new Date().getFullYear();
    yearsSet.add(currentYear);
    this.availableYears = Array.from(yearsSet).sort((a, b) => b - a);
  }

  private matchesBaseFilters(req: FinancialRequest): boolean {
    // Type filter
    if (this.selectedType !== 'ALL' && req.requestType !== this.selectedType) {
      return false;
    }

    // Year filter
    if (this.selectedYear !== 'ALL') {
      const reqYear = req.year || (req.createdAt ? new Date(req.createdAt).getFullYear() : null);
      if (reqYear !== Number(this.selectedYear)) return false;
    }

    // Search query
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return true;

    const applicant = (req.userDisplayName || '').toLowerCase();
    const email = (req.userEmail || '').toLowerCase();
    const id = (req.displayId || req.requestId || '').toLowerCase();
    const position = (req.position || '').toLowerCase();
    const funding = (req.sourceOfFunding || '').toLowerCase();
    const section = (typeof req.getSectionOrCountry === 'function' ? req.getSectionOrCountry() : req.section || req.country || '').toLowerCase();
    const iban = (req.iban || '').toLowerCase();

    const docMatch = req.documents?.some(
      (d) =>
        d.invoiceNumber?.toLowerCase().includes(q) ||
        d.issuedBy?.toLowerCase().includes(q) ||
        d.explanation?.toLowerCase().includes(q)
    );

    return (
      id.includes(q) ||
      applicant.includes(q) ||
      email.includes(q) ||
      position.includes(q) ||
      funding.includes(q) ||
      section.includes(q) ||
      iban.includes(q) ||
      !!docMatch
    );
  }

  public applyFilters(): void {
    if (this.selectedStatus === 'ALL') {
      this.filteredRequests = this.baseFilteredRequests;
    } else {
      this.filteredRequests = this.baseFilteredRequests.filter((req) => req.status === this.selectedStatus);
    }
  }

  public setStatusFilter(status: string): void {
    this.selectedStatus = status;
    this.applyFilters();
  }

  public clearSearch(): void {
    this.searchQuery = '';
    this.applyFilters();
  }

  public resetFilters(): void {
    this.selectedStatus = 'ALL';
    this.selectedType = 'ALL';
    this.selectedYear = this.currentYear.toString();
    this.searchQuery = '';
    this.applyFilters();
  }

  public get isFiltered(): boolean {
    return (
      this.selectedStatus !== 'ALL' ||
      this.selectedType !== 'ALL' ||
      this.selectedYear !== this.currentYear.toString() ||
      !!this.searchQuery
    );
  }

  public viewRequest(requestId: string): void {
    const [seq, year] = requestId.split('/');
    if (year && seq) {
      this.router.navigate(['/t/requests/view', year, seq]);
    } else {
      this.router.navigate(['/t/requests/view', encodeURIComponent(requestId)]);
    }
  }

  public reviewRequest(requestId: string, event?: Event): void {
    if (event) event.stopPropagation();
    if (!this.canManage) {
      this.viewRequest(requestId);
      return;
    }
    const [seq, year] = requestId.split('/');
    if (year && seq) {
      this.router.navigate(['/t/requests/review', year, seq]);
    } else {
      this.router.navigate(['/t/requests/review', encodeURIComponent(requestId)]);
    }
  }

  public openRequest(req: FinancialRequest): void {
    if (this.canManage && req.status !== 'DRAFT') {
      this.reviewRequest(req.requestId);
    } else {
      this.viewRequest(req.requestId);
    }
  }

  public exportData(): void {
    if (!this.canExport) return;
    this.requestsService.exportToCsv(
      this.filteredRequests,
      `esn-finances-requests-${this.selectedStatus.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`
    );
    this.showToast('REQUESTS.MANAGE_PANEL.EXPORT_SUCCESS', 'success');
  }

  public goBackToMyRequests(): void {
    this.router.navigate(['/t/requests']);
  }

  // --- Manager Status Actions ---

  public async takeInReview(req: FinancialRequest, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.canManage) return;

    try {
      await this.requestsService.updateRequestStatus(
        req.requestId,
        'IN_REVIEW',
        this.translate.instant('REQUESTS.MANAGE_PANEL.IN_REVIEW_COMMENT') || 'Review started by manager'
      );
      await this.loadRequests();
      await this.showToast('REQUESTS.MANAGE_PANEL.STATUS_UPDATED', 'success');
    } catch (err: any) {
      this.showToast(err.message || 'Error updating status', 'danger');
    }
  }

  public async promptApprove(req: FinancialRequest, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.canManage) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('REQUESTS.MANAGE_PANEL.APPROVE_HEADER') || 'Approve Request',
      message: `${this.translate.instant('REQUESTS.MANAGE_PANEL.APPROVE_CONFIRM')} ${req.displayId}?`,
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
            await this.executeStatusChange(req.requestId, 'APPROVED', data.comment || 'Request approved');
          }
        }
      ]
    });
    await alert.present();
  }

  public async promptRequestChanges(req: FinancialRequest, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.canManage) return;

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
            await this.executeStatusChange(req.requestId, 'CHANGES_REQUESTED', remarks, remarks);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  public async promptMarkPaid(req: FinancialRequest, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.canManage) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('REQUESTS.MANAGE_PANEL.MARK_PAID_HEADER') || 'Mark as Paid',
      message: `${this.translate.instant('REQUESTS.MANAGE_PANEL.MARK_PAID_CONFIRM')} ${req.displayId} (${req.totalGrossAmount} ${req.currency})?`,
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
            await this.executeStatusChange(req.requestId, 'PAID', data.comment || 'Payout completed');
          }
        }
      ]
    });
    await alert.present();
  }

  public async promptReject(req: FinancialRequest, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.canManage) return;

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
            await this.executeStatusChange(req.requestId, 'REJECTED', reason, reason);
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  private async executeStatusChange(
    requestId: string,
    newStatus: RequestStatus,
    comment?: string,
    adminRemarks?: string
  ): Promise<void> {
    try {
      await this.requestsService.updateRequestStatus(requestId, newStatus, comment, adminRemarks);
      await this.loadRequests();
      await this.showToast('REQUESTS.MANAGE_PANEL.STATUS_UPDATED', 'success');
    } catch (err: any) {
      this.showToast(err.message || 'Error updating status', 'danger');
    }
  }

  private async showToast(messageKey: string, color: 'success' | 'warning' | 'danger'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message: this.translate.instant(messageKey) || messageKey,
      duration: 3500,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
