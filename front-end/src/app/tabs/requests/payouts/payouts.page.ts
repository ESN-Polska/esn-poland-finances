import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';

import { AppService } from '@app/app.service';
import {
  BankTransactionItem,
  RequestsService,
  cleanPolishBankAccount,
  isDomesticAccount,
  isDomesticPlnAccount
} from '@app/services/requests.service';
import {
  FinancialRequest,
  FinancialRequestType,
  InvoiceDocumentItem
} from '@models/financial-request.model';
import { AppPermission } from '@models/configurations.model';
import { MarkPaidModalComponent } from '../markPaidModal.component';
import { BankExportModalComponent } from './bank-export-modal/bank-export-modal.component';

@Component({
  selector: 'app-payouts',
  templateUrl: './payouts.page.html',
  styleUrls: ['./payouts.page.scss']
})
export class PayoutsPage implements OnInit, OnDestroy {
  public isLoading = true;
  public allApprovedRequests: FinancialRequest[] = [];
  public transactions: BankTransactionItem[] = [];

  // Filter state
  public selectedCurrency: 'ALL' | 'PLN' | 'EUR' = 'ALL';
  public selectedScope: 'ALL' | 'DOMESTIC' | 'INTERNATIONAL' = 'ALL';
  public selectedType: 'ALL' | FinancialRequestType = 'ALL';
  public searchQuery = '';

  public requestTypes: FinancialRequestType[] = [
    'INVOICE_REIMBURSEMENT',
    'INVOICE_TO_PAY',
    'ADVANCE_PAYMENT',
    'DELEGATION_SETTLEMENT'
  ];

  public copiedFieldId: string | null = null;
  private copiedTimeout: any = null;
  private reqSub: Subscription | null = null;

  constructor(
    private router: Router,
    private modalCtrl: ModalController,
    private toastCtrl: ToastController,
    private translate: TranslateService,
    private appService: AppService,
    private requestsService: RequestsService
  ) {}

  public async ngOnInit(): Promise<void> {
    await this.loadData();
  }

  public async ionViewWillEnter(): Promise<void> {
    await this.loadData();
  }

  ngOnDestroy(): void {
    if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
  }

  get canAccessPayouts(): boolean {
    const user = this.appService.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.isManager ||
      user.hasPermission(AppPermission.REQUESTS.PAYOUTS) ||
      user.hasPermission(AppPermission.REQUESTS.PARENT)
    );
  }

  get canManage(): boolean {
    const user = this.appService.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.isManager ||
      user.hasPermission(AppPermission.REQUESTS.PAYOUTS) ||
      user.hasPermission(AppPermission.REQUESTS.MANAGE) ||
      user.hasPermission(AppPermission.REQUESTS.PARENT)
    );
  }

  get canConfigureExports(): boolean {
    const user = this.appService.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.hasPermission(AppPermission.CONFIGURATIONS.EXPORTS) ||
      user.hasPermission(AppPermission.CONFIGURATIONS.PARENT)
    );
  }

  get placeholderTag(): string {
    return this.appService.configurations?.bankExportSettings?.unresolvedPlaceholderTag?.trim() || 'XX';
  }

  get isPlaceholderDetectionEnabled(): boolean {
    const settings = this.appService.configurations?.bankExportSettings;
    return (settings?.detectUnresolvedPlaceholders !== false) && !!this.placeholderTag;
  }

  public isItemPlaceholderUnresolved(title: string | null | undefined): boolean {
    return this.isPlaceholderDetectionEnabled && !!title && title.includes(this.placeholderTag);
  }

  private async ensureAppReady(): Promise<void> {
    if (this.appService.isReady && this.appService.currentUser) return;
    return new Promise((resolve) => {
      const sub = this.appService.user$.subscribe((user) => {
        if (this.appService.isReady || user !== null) {
          sub.unsubscribe();
          resolve();
        }
      });
      setTimeout(() => {
        sub.unsubscribe();
        resolve();
      }, 3000);
    });
  }

  public async loadData(): Promise<void> {
    this.isLoading = true;
    try {
      await this.ensureAppReady();
      if (!this.canAccessPayouts) {
        this.router.navigate(['/t/requests']);
        return;
      }
      const loaded = await this.requestsService.loadAllRequests();
      this.processRequests(loaded);
    } catch (err: any) {
      this.showToast(err?.message || 'Error loading requests', 'danger');
    } finally {
      this.isLoading = false;
    }
  }

  public async doRefresh(event: any): Promise<void> {
    try {
      await this.ensureAppReady();
      const loaded = await this.requestsService.loadAllRequests();
      this.processRequests(loaded);
    } catch (err: any) {
      this.showToast(err?.message || 'Error refreshing requests', 'danger');
    } finally {
      if (event?.target?.complete) {
        event.target.complete();
      }
    }
  }

  private processRequests(reqs: FinancialRequest[]): void {
    this.allApprovedRequests = (reqs || []).filter(r => r.status === 'APPROVED');
    this.transactions = this.requestsService.buildBankTransactions(this.allApprovedRequests);
  }

  // --- Metrics ---

  get totalApprovedCount(): number {
    return this.transactions.length;
  }

  get totalPlnAmount(): number {
    return this.transactions
      .filter(t => t.currency === 'PLN')
      .reduce((acc, curr) => acc + (curr.amount || 0), 0);
  }

  get totalEurAmount(): number {
    return this.transactions
      .filter(t => t.currency === 'EUR')
      .reduce((acc, curr) => acc + (curr.amount || 0), 0);
  }

  get domesticCount(): number {
    return this.transactions.filter(t => t.isDomestic).length;
  }

  get domesticPlnCount(): number {
    return this.transactions.filter(t => t.isDomesticPln).length;
  }

  get internationalCount(): number {
    return this.transactions.filter(t => !t.isDomestic).length;
  }

  // --- Filtered Items ---

  get filteredTransactions(): BankTransactionItem[] {
    const q = this.searchQuery.trim().toLowerCase();

    return this.transactions.filter(t => {
      // Currency filter
      if (this.selectedCurrency !== 'ALL' && t.currency !== this.selectedCurrency) {
        return false;
      }

      // Scope filter
      if (this.selectedScope === 'DOMESTIC' && !t.isDomestic) {
        return false;
      }
      if (this.selectedScope === 'INTERNATIONAL' && t.isDomestic) {
        return false;
      }

      // Request type filter
      if (this.selectedType !== 'ALL' && t.requestType !== this.selectedType) {
        return false;
      }

      // Search query
      if (q) {
        const matchId = t.displayId?.toLowerCase().includes(q) || t.requestId?.toLowerCase().includes(q);
        const matchRecipient = t.recipientName?.toLowerCase().includes(q);
        const matchAccount = t.recipientAccount?.toLowerCase().includes(q) || t.cleanRecipientAccount?.includes(q);
        const matchTitle = t.title?.toLowerCase().includes(q);
        const matchInvoice = t.invoiceNumber?.toLowerCase().includes(q);
        const matchKsef = t.ksefNumber?.toLowerCase().includes(q);
        const matchApplicant = t.originalRequest?.userDisplayName?.toLowerCase().includes(q);

        if (!matchId && !matchRecipient && !matchAccount && !matchTitle && !matchInvoice && !matchKsef && !matchApplicant) {
          return false;
        }
      }

      return true;
    });
  }

  public get isFiltered(): boolean {
    return (
      this.selectedCurrency !== 'ALL' ||
      this.selectedScope !== 'ALL' ||
      this.selectedType !== 'ALL' ||
      (!!this.searchQuery && this.searchQuery.trim().length > 0)
    );
  }

  public clearSearch(): void {
    this.searchQuery = '';
  }

  public resetFilters(): void {
    this.selectedCurrency = 'ALL';
    this.selectedScope = 'ALL';
    this.selectedType = 'ALL';
    this.searchQuery = '';
  }

  // --- Copy to Clipboard with Visual Confirmation ---

  public async copyToClipboard(text: string | null | undefined, fieldId: string, labelKey?: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copiedFieldId = fieldId;
      if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
      this.copiedTimeout = setTimeout(() => {
        this.copiedFieldId = null;
      }, 2000);

      const label = labelKey ? this.translate.instant(labelKey) : '';
      const msg = label
        ? `${this.translate.instant('REQUESTS.PAYOUTS.COPIED')}: ${label}`
        : this.translate.instant('REQUESTS.PAYOUTS.COPIED_TO_CLIPBOARD');
      this.showToast(msg, 'success', 1500);
    } catch {
      this.showToast('REQUESTS.PAYOUTS.COPY_FAILED', 'warning');
    }
  }

  public isFieldCopied(fieldId: string): boolean {
    return this.copiedFieldId === fieldId;
  }

  public formatIbanDisplay(val: string | null | undefined): string {
    if (!val) return '—';
    const clean = val.replace(/\s+/g, '');
    return clean.replace(/(.{4})/g, '$1 ').trim();
  }

  // --- Actions ---

  public async openBankExportModal(): Promise<void> {
    const sourceList = this.isFiltered ? this.filteredTransactions : this.transactions;
    const exportableItems = sourceList.filter(t => t.isDomesticPln);

    const modal = await this.modalCtrl.create({
      component: BankExportModalComponent,
      cssClass: 'bankExportModal',
      componentProps: {
        transactions: exportableItems
      }
    });

    await modal.present();
    const { role } = await modal.onWillDismiss();
    if (role === 'confirm') {
      // Refresh to keep state updated
      this.loadData();
    }
  }

  public async promptMarkPaid(txOrReq: BankTransactionItem | FinancialRequest, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.canManage) return;

    const isTx = 'originalRequest' in txOrReq;
    const req = isTx ? (txOrReq as BankTransactionItem).originalRequest : (txOrReq as FinancialRequest);
    const tx = isTx ? (txOrReq as BankTransactionItem) : undefined;

    const modal = await this.modalCtrl.create({
      component: MarkPaidModalComponent,
      componentProps: {
        request: req,
        transaction: tx
      }
    });
    await modal.present();

    const { data, role } = await modal.onWillDismiss();
    if (role === 'confirm' && data) {
      try {
        const reqType = req?.requestType || tx?.requestType || (txOrReq as any)?.requestType;
        const isAdvanceOrDelegation =
          reqType === 'ADVANCE_PAYMENT' ||
          reqType === 'DELEGATION_SETTLEMENT';

        if (isAdvanceOrDelegation) {
          await this.requestsService.updateRequestStatus(
            req.requestId,
            'PAID',
            data.comment || 'REQUESTS.HISTORY_COMMENTS.PAYOUT_COMPLETED',
            undefined,
            data.paymentConfirmationAttachment,
            data.paymentConfirmationAttachments
          );
        } else {
          await this.requestsService.markPayoutItemPaid(
            req,
            data.transaction || tx,
            data.mode || 'SINGLE',
            data.comment,
            data.paymentConfirmationAttachment,
            data.paymentConfirmationAttachments
          );
        }
        await this.loadData();
        this.showToast('REQUESTS.MANAGE_PANEL.STATUS_UPDATED', 'success');
      } catch (err: any) {
        this.showToast(err?.message || 'Error updating status', 'danger');
      }
    }
  }

  public viewRequest(requestId: string): void {
    const [seq, year] = requestId.split('/');
    if (year && seq) {
      this.router.navigate(['/t/requests/view', year, seq]);
    } else {
      this.router.navigate(['/t/requests/view', encodeURIComponent(requestId)]);
    }
  }

  public goBack(): void {
    this.router.navigate(['/t/requests/manage']);
  }

  public goToConfigurations(): void {
    this.router.navigate(['/t/configurations'], { queryParams: { section: 'EXPORTS', subtab: 'BANK' } });
  }

  private async showToast(messageKey: string, color: string, duration = 3000): Promise<void> {
    const msg = this.translate.instant(messageKey);
    const toast = await this.toastCtrl.create({
      message: msg && msg !== messageKey ? msg : messageKey,
      duration,
      position: 'bottom',
      color
    });
    await toast.present();
  }
}
