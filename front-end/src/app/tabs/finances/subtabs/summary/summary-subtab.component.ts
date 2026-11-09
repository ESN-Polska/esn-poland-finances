import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesService } from '../../../../services/finances.service';
import { MediaService } from '../../../../common/media.service';
import { AppService } from '../../../../app.service';
import { MonthlyReconciliationRecord, MonthlyReconciliationRow, ReconciliationStatus } from '@models/subledgers.model';
import { AppPermission } from '@models/configurations.model';
import { BankTransactionRecord } from '@models/cashflow-transaction.model';
import { AnnualBudget } from '@models/annual-budget.model';
import { formatLocaleNumber } from '@app/utils/number-utils';

@Component({
  selector: 'app-summary-subtab',
  templateUrl: './summary-subtab.component.html',
  styleUrls: ['./summary-subtab.component.scss']
})
export class SummarySubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  private financesService = inject(FinancesService);
  private mediaService = inject(MediaService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private loadingCtrl = inject(LoadingController);
  private translate = inject(TranslateService);

  loading: boolean = true;
  reconciliationRecord: MonthlyReconciliationRecord | null = null;
  lastImportedBookingDate: string | null = null;
  cachedTxs: BankTransactionRecord[] = [];
  cachedBudget: AnnualBudget | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadReconciliationData(year);
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get canEdit(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.isManager ||
      user.hasPermission(AppPermission.FINANCES.MANAGE) ||
      user.hasPermission(AppPermission.FINANCES.PARENT)
    );
  }

  get isArchived(): boolean {
    return this.stateService.isArchived;
  }

  async loadReconciliationData(year: number): Promise<void> {
    this.loading = true;
    try {
      const [records, txs, budget] = await Promise.all([
        this.financesService.getReconciliations(year),
        this.financesService.getTransactions(year),
        this.financesService.getBudget(year).catch(() => null)
      ]);

      this.cachedTxs = txs || [];
      this.cachedBudget = budget || null;

      if (records && records.length > 0) {
        const sorted = [...records].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        this.reconciliationRecord = sorted[0];
      } else {
        this.reconciliationRecord = new MonthlyReconciliationRecord({ year, id: `reconciliation_${year}` });
      }

      // Check latest transaction booking date
      if (this.cachedTxs.length > 0) {
        const sorted = [...this.cachedTxs].sort((a, b) => (b.bookingDate || '').localeCompare(a.bookingDate || ''));
        this.lastImportedBookingDate = sorted[0].bookingDate || null;
      } else {
        this.lastImportedBookingDate = this.reconciliationRecord.lastImportedBookingDate || null;
      }

      // Calculate monthly inflows, outflows, and system expected closing from imported transactions
      this.recalculateReconciliation(this.reconciliationRecord, this.cachedTxs, this.cachedBudget);
    } catch (err: any) {
      console.error('Failed to load reconciliations', err);
    } finally {
      this.loading = false;
    }
  }

  private extractTxMonth(tx: BankTransactionRecord, year: number): number | null {
    const dateStr = (tx.bookingDate || tx.operationDate || '').trim();
    if (!dateStr) return null;

    const isoMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      const y = parseInt(isoMatch[1], 10);
      const m = parseInt(isoMatch[2], 10);
      if (y === year && m >= 1 && m <= 12) return m;
    }

    const euMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
    if (euMatch) {
      const y = parseInt(euMatch[3], 10);
      const m = parseInt(euMatch[2], 10);
      if (y === year && m >= 1 && m <= 12) return m;
    }

    const d = new Date(dateStr);
    if (!isNaN(d.getTime()) && d.getFullYear() === year) {
      return d.getMonth() + 1;
    }

    return null;
  }

  private recalculateReconciliation(
    record: MonthlyReconciliationRecord,
    txs: BankTransactionRecord[],
    budget?: AnnualBudget | null
  ): void {
    const year = record.year;

    // Chronological order: bookingDate asc, statementSequenceNumber desc (highest seq is earliest)
    const sortedTxs = [...txs].sort((a, b) => {
      const dateA = a.bookingDate || a.operationDate || '';
      const dateB = b.bookingDate || b.operationDate || '';
      const dateCmp = dateA.localeCompare(dateB);
      if (dateCmp !== 0) return dateCmp;
      return (b.statementSequenceNumber || 0) - (a.statementSequenceNumber || 0);
    });

    const txsByMonthPln = new Map<number, BankTransactionRecord[]>();
    const txsByMonthEur = new Map<number, BankTransactionRecord[]>();

    for (const tx of sortedTxs) {
      const month = this.extractTxMonth(tx, year);
      if (!month) continue;
      const curr = (tx.currency || 'PLN').toUpperCase() === 'EUR' ? 'EUR' : 'PLN';
      if (curr === 'PLN') {
        if (!txsByMonthPln.has(month)) txsByMonthPln.set(month, []);
        txsByMonthPln.get(month)!.push(tx);
      } else {
        if (!txsByMonthEur.has(month)) txsByMonthEur.set(month, []);
        txsByMonthEur.get(month)!.push(tx);
      }
    }

    const budgetStartPln =
      budget?.openingBalances?.bankPlnStartingBalance ||
      budget?.openingBalances?.bankPln ||
      0;
    const budgetStartEur =
      budget?.openingBalances?.bankEurStartingBalance ||
      0;

    let lastMonthPlnActual: number | undefined = undefined;
    let lastMonthPlnExpected: number | null = null;
    let lastMonthEurActual: number | undefined = undefined;
    let lastMonthEurExpected: number | null = null;

    for (let m = 1; m <= 12; m++) {
      const row = record.months.find((r) => r.month === m);
      if (!row) continue;

      const plnTxs = txsByMonthPln.get(m) || [];
      const eurTxs = txsByMonthEur.get(m) || [];

      // 1. PLN Movements
      let plnIn = 0;
      let plnOut = 0;
      for (const t of plnTxs) {
        const amt = Number(t.amount) || 0;
        if (amt > 0) plnIn += amt;
        else plnOut += Math.abs(amt);
      }
      row.plnInflows = Math.round(plnIn * 100) / 100;
      row.plnOutflows = Math.round(plnOut * 100) / 100;
      row.plnNetBalance = Math.round((row.plnInflows - row.plnOutflows) * 100) / 100;

      // PLN Starting Balance:
      // Month 1: from budget opening balance (or earliest tx balanceAfter if 0)
      // Month > 1: from last month's actual balance, or cascades from last month's expected
      if (m === 1) {
        if (budgetStartPln !== 0) {
          row.plnStartingBalance = budgetStartPln;
        } else if (plnTxs.length > 0 && plnTxs[0].balanceAfter !== undefined && plnTxs[0].balanceAfter !== null) {
          row.plnStartingBalance = Math.round((Number(plnTxs[0].balanceAfter) - (Number(plnTxs[0].amount) || 0)) * 100) / 100;
        } else {
          row.plnStartingBalance = 0;
        }
      } else if (lastMonthPlnActual !== undefined && lastMonthPlnActual !== null) {
        row.plnStartingBalance = lastMonthPlnActual;
      } else if (lastMonthPlnExpected !== null) {
        row.plnStartingBalance = lastMonthPlnExpected;
      } else if (plnTxs.length > 0 && plnTxs[0].balanceAfter !== undefined && plnTxs[0].balanceAfter !== null) {
        row.plnStartingBalance = Math.round((Number(plnTxs[0].balanceAfter) - (Number(plnTxs[0].amount) || 0)) * 100) / 100;
      } else {
        row.plnStartingBalance = 0;
      }

      row.plnExpectedClosing = Math.round((row.plnStartingBalance + row.plnNetBalance) * 100) / 100;
      lastMonthPlnActual = row.plnActualClosing;
      lastMonthPlnExpected = row.plnExpectedClosing;

      // 2. EUR Movements
      let eurIn = 0;
      let eurOut = 0;
      for (const t of eurTxs) {
        const amt = Number(t.amount) || 0;
        if (amt > 0) eurIn += amt;
        else eurOut += Math.abs(amt);
      }
      row.eurInflows = Math.round(eurIn * 100) / 100;
      row.eurOutflows = Math.round(eurOut * 100) / 100;
      row.eurNetBalance = Math.round((row.eurInflows - row.eurOutflows) * 100) / 100;

      // EUR Starting Balance:
      // Month 1: from budget opening balance (or earliest tx balanceAfter if 0)
      // Month > 1: from last month's actual balance, or cascades from last month's expected
      if (m === 1) {
        if (budgetStartEur !== 0) {
          row.eurStartingBalance = budgetStartEur;
        } else if (eurTxs.length > 0 && eurTxs[0].balanceAfter !== undefined && eurTxs[0].balanceAfter !== null) {
          row.eurStartingBalance = Math.round((Number(eurTxs[0].balanceAfter) - (Number(eurTxs[0].amount) || 0)) * 100) / 100;
        } else {
          row.eurStartingBalance = 0;
        }
      } else if (lastMonthEurActual !== undefined && lastMonthEurActual !== null) {
        row.eurStartingBalance = lastMonthEurActual;
      } else if (lastMonthEurExpected !== null) {
        row.eurStartingBalance = lastMonthEurExpected;
      } else if (eurTxs.length > 0 && eurTxs[0].balanceAfter !== undefined && eurTxs[0].balanceAfter !== null) {
        row.eurStartingBalance = Math.round((Number(eurTxs[0].balanceAfter) - (Number(eurTxs[0].amount) || 0)) * 100) / 100;
      } else {
        row.eurStartingBalance = 0;
      }

      row.eurExpectedClosing = Math.round((row.eurStartingBalance + row.eurNetBalance) * 100) / 100;
      lastMonthEurActual = row.eurActualClosing;
      lastMonthEurExpected = row.eurExpectedClosing;

      // 3. Statuses
      if (row.plnActualClosing !== undefined && row.plnActualClosing !== null) {
        const diff = Math.abs(row.plnActualClosing - row.plnExpectedClosing);
        row.plnStatus = diff < 0.005 ? 'MATCHED' : 'DISCREPANCY';
      } else {
        row.plnStatus = 'NO_DATA';
      }

      if (row.eurActualClosing !== undefined && row.eurActualClosing !== null) {
        const diff = Math.abs(row.eurActualClosing - row.eurExpectedClosing);
        row.eurStatus = diff < 0.005 ? 'MATCHED' : 'DISCREPANCY';
      } else {
        row.eurStatus = 'NO_DATA';
      }
    }
  }

  getTooltipBreakdown(row: MonthlyReconciliationRow, currency: 'PLN' | 'EUR'): string {
    const locale = this.app.numberFormatLocale;
    if (currency === 'PLN') {
      return this.translate.instant('FINANCES.SUMMARY.TOOLTIP_BREAKDOWN', {
        inflows: formatLocaleNumber(row.plnInflows || 0, locale, 2, 2),
        outflows: formatLocaleNumber(row.plnOutflows || 0, locale, 2, 2),
        net: formatLocaleNumber(row.plnNetBalance || 0, locale, 2, 2)
      });
    } else {
      return this.translate.instant('FINANCES.SUMMARY.TOOLTIP_BREAKDOWN_EUR', {
        inflows: formatLocaleNumber(row.eurInflows || 0, locale, 2, 2),
        outflows: formatLocaleNumber(row.eurOutflows || 0, locale, 2, 2),
        net: formatLocaleNumber(row.eurNetBalance || 0, locale, 2, 2)
      });
    }
  }

  get months(): MonthlyReconciliationRow[] {
    return this.reconciliationRecord?.months || [];
  }

  getStatusBadgeClass(status: ReconciliationStatus): string {
    switch (status) {
      case 'MATCHED':
        return 'statusMatched';
      case 'DISCREPANCY':
        return 'statusDiscrepancy';
      default:
        return 'statusMissing';
    }
  }

  getStatusLabel(status: ReconciliationStatus): string {
    switch (status) {
      case 'MATCHED':
        return this.translate.instant('FINANCES.SUMMARY.STATUS_MATCHED');
      case 'DISCREPANCY':
        return this.translate.instant('FINANCES.SUMMARY.STATUS_DISCREPANCY');
      default:
        return this.translate.instant('FINANCES.SUMMARY.STATUS_NO_DATA');
    }
  }

  async editMonthBalances(row: MonthlyReconciliationRow): Promise<void> {
    if (!this.canEdit || this.isArchived || !this.reconciliationRecord) return;

    const monthLabel = (this.app.currentLanguage === 'en' ? row.monthName.en : row.monthName.pl) || row.monthName.pl || row.monthName.en;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.SUMMARY.EDIT_MODAL_TITLE', { month: monthLabel, year: this.reconciliationRecord.year }),
      subHeader: this.translate.instant('FINANCES.SUMMARY.EDIT_MODAL_SUBTITLE'),
      inputs: [
        {
          name: 'plnActual',
          type: 'number',
          placeholder: this.translate.instant('FINANCES.SUMMARY.PLN_CLOSING_PH'),
          value: row.plnActualClosing !== undefined ? row.plnActualClosing : ''
        },
        {
          name: 'eurActual',
          type: 'number',
          placeholder: this.translate.instant('FINANCES.SUMMARY.EUR_CLOSING_PH'),
          value: row.eurActualClosing !== undefined ? row.eurActualClosing : ''
        },
        {
          name: 'comment',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.SUMMARY.NOTES_PH'),
          value: row.comment || ''
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data) => {
            const plnVal = data.plnActual !== '' && !isNaN(Number(data.plnActual)) ? Number(data.plnActual) : undefined;
            const eurVal = data.eurActual !== '' && !isNaN(Number(data.eurActual)) ? Number(data.eurActual) : undefined;

            row.plnActualClosing = plnVal;
            row.eurActualClosing = eurVal;
            row.comment = data.comment;

            this.recalculateReconciliation(this.reconciliationRecord!, this.cachedTxs, this.cachedBudget);

            await this.saveReconciliationRecord();
          }
        }
      ]
    });
    await alert.present();
  }

  async attachStatement(row: MonthlyReconciliationRow, currency: 'PLN' | 'EUR'): Promise<void> {
    if (!this.canEdit || this.isArchived || !this.reconciliationRecord) return;

    const file = await this.triggerFileInput('.pdf,application/pdf');
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.SUMMARY.INVALID_PDF'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    const loader = await this.loadingCtrl.create({
      message: this.translate.instant('FINANCES.SUMMARY.UPLOADING_STMT')
    });
    await loader.present();

    try {
      const uploadRes = await this.mediaService.uploadDocument(file);
      const attachment = {
        fileId: uploadRes.id,
        fileName: file.name,
        name: file.name,
        url: uploadRes.url,
        fileSize: file.size,
        contentType: file.type || 'application/pdf',
        s3Key: uploadRes.s3Key,
        uploadedAt: new Date().toISOString()
      };

      if (currency === 'PLN') {
        row.plnStatementAttachment = attachment;
      } else {
        row.eurStatementAttachment = attachment;
      }

      await this.saveReconciliationRecord();

      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.SUMMARY.UPLOAD_SUCCESS'),
        duration: 2500,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      console.error('Failed to upload bank statement to platform storage', err);
      const toast = await this.toastCtrl.create({
        message: err.message || this.translate.instant('FINANCES.SUMMARY.UPLOAD_ERROR'),
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      await loader.dismiss();
    }
  }

  async removeStatement(row: MonthlyReconciliationRow, currency: 'PLN' | 'EUR'): Promise<void> {
    if (!this.canEdit || this.isArchived || !this.reconciliationRecord) return;

    const monthLabel = (this.app.currentLanguage === 'en' ? row.monthName.en : row.monthName.pl) || row.monthName.pl || row.monthName.en;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.SUMMARY.DELETE_CONFIRM_TITLE', { currency }),
      message: this.translate.instant('FINANCES.SUMMARY.DELETE_CONFIRM_MSG', { month: monthLabel }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            if (currency === 'PLN') {
              row.plnStatementAttachment = undefined;
            } else {
              row.eurStatementAttachment = undefined;
            }
            await this.saveReconciliationRecord();
          }
        }
      ]
    });
    await alert.present();
  }

  private triggerFileInput(accept: string = '.pdf,application/pdf'): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => {
        const file = input.files?.[0] || null;
        resolve(file);
      };
      input.click();
    });
  }

  async saveReconciliationRecord(): Promise<void> {
    if (!this.reconciliationRecord) return;
    try {
      this.reconciliationRecord = await this.financesService.saveReconciliation(this.reconciliationRecord);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.SUMMARY.SAVE_SUCCESS'),
        duration: 2000,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.SUMMARY.SAVE_ERROR'),
        duration: 3500,
        color: 'danger'
      });
      await toast.present();
    }
  }
}
