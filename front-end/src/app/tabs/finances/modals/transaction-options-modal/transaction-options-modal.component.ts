import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import {
  BankTransactionRecord,
  TransactionSettlement,
  DirectCodeSplitItem,
  TransactionSettlementTargetType
} from '@models/cashflow-transaction.model';
import { DocumentRecord } from '@models/accounting-document.model';
import { FiscalMonthlyReport } from '@models/fiscal-report.model';
import { FinancesService } from '../../../../services/finances.service';

@Component({
  selector: 'app-transaction-options-modal',
  templateUrl: './transaction-options-modal.component.html',
  styleUrls: ['./transaction-options-modal.component.scss']
})
export class TransactionOptionsModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private financesService = inject(FinancesService);
  private translate = inject(TranslateService);

  @Input() transaction!: BankTransactionRecord;
  @Input() year: number = new Date().getFullYear();
  @Input() canEdit: boolean = true;

  public activeTab: 'SETTLEMENT' | 'DIRECT_SPLIT' = 'SETTLEMENT';
  public loading: boolean = false;

  // Tab 1: Settlements (Documents & Fiscal Reports)
  public settlements: TransactionSettlement[] = [];
  public availableDocuments: DocumentRecord[] = [];
  public availableFiscalReports: FiscalMonthlyReport[] = [];
  public selectedDocIdToAdd: string = '';
  public selectedFiscalIdToAdd: string = '';

  // Tab 2: Direct Code Splits
  public directSplits: DirectCodeSplitItem[] = [];

  ngOnInit(): void {
    if (this.transaction.directCodeSplits?.length || this.transaction.directBudgetCode) {
      this.activeTab = 'DIRECT_SPLIT';
    } else {
      this.activeTab = 'SETTLEMENT';
    }

    this.settlements = (this.transaction.settlements || []).map((s) => ({ ...s }));

    if (this.transaction.directCodeSplits?.length) {
      this.directSplits = this.transaction.directCodeSplits.map((s) => ({ ...s }));
    } else if (this.transaction.directBudgetCode) {
      this.directSplits = [
        {
          id: `split_${Date.now()}`,
          code: this.transaction.directBudgetCode,
          codeType: 'BUDGET_CODE',
          amount: Math.abs(this.transaction.amount),
          description: this.transaction.notes || ''
        }
      ];
    } else {
      this.directSplits = [
        {
          id: `split_${Date.now()}`,
          code: '',
          codeType: 'BUDGET_CODE',
          amount: Math.abs(this.transaction.amount)
        }
      ];
    }

    this.loadPrerequisites();
  }

  private async loadPrerequisites(): Promise<void> {
    this.loading = true;
    try {
      const [docs, fiscal] = await Promise.all([
        this.financesService.getDocuments(this.year).catch(() => []),
        this.financesService.getFiscalReports(this.year).catch(() => [])
      ]);
      this.availableDocuments = docs;
      this.availableFiscalReports = fiscal;
    } finally {
      this.loading = false;
    }
  }

  get targetAmount(): number {
    return Math.abs(this.transaction.amount);
  }

  // --- TAB 1: Settlements Logic ---
  get totalSettledAmount(): number {
    return this.settlements.reduce((sum, s) => sum + (Number(s.allocatedAmount) || 0), 0);
  }

  get settlementDelta(): number {
    return Math.round((this.targetAmount - this.totalSettledAmount) * 100) / 100;
  }

  public addDocumentSettlement(): void {
    if (!this.selectedDocIdToAdd) return;
    const doc = this.availableDocuments.find((d) => d.id === this.selectedDocIdToAdd);
    if (!doc) return;

    if (this.settlements.some((s) => s.targetId === doc.id)) return;

    const remaining = Math.max(0, this.settlementDelta);
    const alloc = Math.min(doc.grossAmount, remaining || doc.grossAmount);

    this.settlements.push({
      settlementId: `set_doc_${Date.now()}`,
      targetType: 'DOCUMENT',
      targetId: doc.id,
      targetLabel: doc.invoiceNumber || doc.ksefNumber || 'Dokument',
      allocatedAmount: alloc,
      notes: doc.issuedBy
    });

    this.selectedDocIdToAdd = '';
  }

  public addFiscalSettlement(): void {
    if (!this.selectedFiscalIdToAdd) return;
    const report = this.availableFiscalReports.find((r) => r.id === this.selectedFiscalIdToAdd);
    if (!report) return;

    if (this.settlements.some((s) => s.targetId === report.id)) return;

    const remaining = Math.max(0, this.settlementDelta);
    const reportTotal = report.totalGross || (report as any).grossTotal || 0;
    const alloc = Math.min(reportTotal, remaining || reportTotal);

    this.settlements.push({
      settlementId: `set_fisc_${Date.now()}`,
      targetType: 'FISCAL_DAILY_REPORT',
      targetId: report.id,
      targetLabel: `${report.monthName} ${report.year}`,
      allocatedAmount: alloc
    });

    this.selectedFiscalIdToAdd = '';
  }

  public removeSettlement(index: number): void {
    this.settlements.splice(index, 1);
  }

  public fillSettlementRemainder(s: TransactionSettlement): void {
    const others = this.settlements.filter((item) => item !== s).reduce((sum, item) => sum + (Number(item.allocatedAmount) || 0), 0);
    s.allocatedAmount = Math.max(0, Math.round((this.targetAmount - others) * 100) / 100);
  }

  // --- TAB 2: Direct Splits Logic ---
  get totalDirectSplitAmount(): number {
    return this.directSplits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  }

  get directSplitDelta(): number {
    return Math.round((this.targetAmount - this.totalDirectSplitAmount) * 100) / 100;
  }

  public addDirectSplitRow(): void {
    const rem = Math.max(0, this.directSplitDelta);
    this.directSplits.push({
      id: `split_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      code: '',
      codeType: 'BUDGET_CODE',
      amount: rem
    });
  }

  public removeDirectSplitRow(index: number): void {
    this.directSplits.splice(index, 1);
  }

  public fillDirectSplitRemainder(item: DirectCodeSplitItem): void {
    const others = this.directSplits.filter((s) => s !== item).reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    item.amount = Math.max(0, Math.round((this.targetAmount - others) * 100) / 100);
  }

  // --- Clear / Reset ---
  public async clearAllAssignments(): Promise<void> {
    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('COMMON.SAVING')
    });
    await loading.present();
    try {
      this.transaction.settlements = [];
      this.transaction.directBudgetCode = undefined;
      this.transaction.directCodeSplits = [];
      this.transaction.reconciliationStatus = 'UNLINKED';
      this.transaction.settlementStatus = 'UNSETTLED';

      const saved = await this.financesService.saveTransaction(this.transaction);
      await loading.dismiss();
      this.modalCtrl.dismiss({ savedTransaction: saved, role: 'saved' });
    } catch (err: any) {
      await loading.dismiss();
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('COMMON.SAVE_ERROR'),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  // --- Save ---
  public async save(): Promise<void> {
    if (this.activeTab === 'SETTLEMENT') {
      if (this.settlements.length === 0) {
        const toast = await this.toastCtrl.create({
          message: this.translate.instant('FINANCES.TRANSACTIONS.SETTLEMENT_EMPTY_ERROR'),
          duration: 3000,
          color: 'warning'
        });
        await toast.present();
        return;
      }
      if (Math.abs(this.settlementDelta) > 0.01) {
        const toast = await this.toastCtrl.create({
          message: this.translate.instant('FINANCES.TRANSACTIONS.SETTLEMENT_DELTA_ERROR', { delta: this.settlementDelta }),
          duration: 3500,
          color: 'warning'
        });
        await toast.present();
        return;
      }

      this.transaction.settlements = this.settlements.map((s) => ({
        settlementId: s.settlementId,
        targetType: s.targetType,
        targetId: s.targetId,
        targetLabel: s.targetLabel,
        allocatedAmount: Number(s.allocatedAmount) || 0,
        notes: s.notes
      }));
      this.transaction.directBudgetCode = undefined;
      this.transaction.directCodeSplits = [];
      this.transaction.reconciliationStatus = 'MATCHED';
      this.transaction.settlementStatus = 'SETTLED';
    } else {
      // Direct split
      const validSplits = this.directSplits.filter((s) => !!s.code);
      if (validSplits.length === 0) {
        const toast = await this.toastCtrl.create({
          message: this.translate.instant('FINANCES.TRANSACTIONS.DIRECT_SPLIT_EMPTY_ERROR'),
          duration: 3000,
          color: 'warning'
        });
        await toast.present();
        return;
      }
      if (Math.abs(this.directSplitDelta) > 0.01) {
        const toast = await this.toastCtrl.create({
          message: this.translate.instant('FINANCES.TRANSACTIONS.DIRECT_SPLIT_DELTA_ERROR', { delta: this.directSplitDelta }),
          duration: 3500,
          color: 'warning'
        });
        await toast.present();
        return;
      }

      this.transaction.settlements = [];
      this.transaction.directCodeSplits = validSplits.map((s) => ({
        id: s.id,
        code: s.code,
        codeType: s.codeType || 'BUDGET_CODE',
        amount: Number(s.amount) || 0,
        description: s.description
      }));

      if (validSplits.length === 1) {
        this.transaction.directBudgetCode = validSplits[0].code;
      } else {
        this.transaction.directBudgetCode = undefined;
      }
      this.transaction.isBankFeeOrInterest = true;
      this.transaction.reconciliationStatus = 'DIRECT_CODED';
      this.transaction.settlementStatus = 'SETTLED';
    }

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('COMMON.SAVING')
    });
    await loading.present();

    try {
      const saved = await this.financesService.saveTransaction(this.transaction);
      await loading.dismiss();
      this.modalCtrl.dismiss({ savedTransaction: saved, role: 'saved' });
    } catch (err: any) {
      await loading.dismiss();
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('COMMON.SAVE_ERROR'),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  public dismiss(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }
}
