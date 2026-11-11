import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController, AlertController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AnnualBudget, BudgetVersionSnapshot, BudgetAmendment } from '@models/annual-budget.model';
import { DateFormatOption, DEFAULT_DATE_FORMAT } from '@models/configurations.model';
import { formatDateOption } from '../../../../utils/date-utils';
import {
  generateBudgetCsvContent,
  generateBudgetHtmlReport,
  downloadCsvFile,
  openPrintablePdf
} from '../../subtabs/budget/budget-export.util';
import { AppService } from '../../../../app.service';
import { FinancesService } from '../../../../services/finances.service';

@Component({
  selector: 'app-budget-history-modal',
  templateUrl: './budget-history-modal.component.html',
  styleUrls: ['./budget-history-modal.component.scss']
})
export class BudgetHistoryModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private loadingCtrl = inject(LoadingController);
  private translate = inject(TranslateService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);

  @Input() budget!: AnnualBudget;
  @Input() activeSnapshotId?: string;
  @Input() canEdit: boolean = false;

  versionHistory: BudgetVersionSnapshot[] = [];
  dateFormat: DateFormatOption = DEFAULT_DATE_FORMAT;
  hasBudgetBeenUpdated: boolean = false;

  ngOnInit(): void {
    if (this.budget?.versionHistory && this.budget.versionHistory.length > 0) {
      // Sort newest to oldest
      this.versionHistory = [...this.budget.versionHistory].sort(
        (a, b) => new Date(b.adoptedDate || b.createdAt).getTime() - new Date(a.adoptedDate || a.createdAt).getTime()
      );
    } else if (this.budget && this.budget.status !== 'DRAFT') {
      // Fallback if versionHistory is missing for an already adopted budget
      const fallbackSnap: BudgetVersionSnapshot = {
        id: `snap_init_${this.budget.year}`,
        type: 'INITIAL_ADOPTION',
        resolutionNumber: this.budget.initialResolutionNumber || this.budget.resolutionNumber || '',
        adoptedDate: this.budget.initialAdoptedDate || this.budget.adoptedDate || '',
        createdAt: this.budget.createdAt || new Date().toISOString(),
        description: '',
        totalRevenue: this.budget.totalBudgetedRevenue || 0,
        totalExpense: this.budget.totalBudgetedExpense || 0,
        netResult: (this.budget.totalBudgetedRevenue || 0) - (this.budget.totalBudgetedExpense || 0),
        categories: this.budget.categories || []
      };
      this.versionHistory = [fallbackSnap];
      this.budget.versionHistory = [fallbackSnap];
    }
  }

  close(): void {
    this.modalCtrl.dismiss({
      action: this.hasBudgetBeenUpdated ? 'BUDGET_UPDATED' : undefined,
      budget: this.hasBudgetBeenUpdated ? this.budget : undefined
    });
  }

  formatDate(dateStr?: string): string {
    return formatDateOption(dateStr, this.dateFormat);
  }

  viewSnapshot(snap: BudgetVersionSnapshot): void {
    this.modalCtrl.dismiss({
      action: 'VIEW_SNAPSHOT',
      snapshot: snap,
      budget: this.hasBudgetBeenUpdated ? this.budget : undefined
    });
  }

  getAmendmentForSnapshot(snap: BudgetVersionSnapshot): BudgetAmendment | undefined {
    if (snap.type !== 'AMENDMENT') return undefined;
    return this.budget?.amendments?.find(
      (a) => (snap.amendmentId && a.id === snap.amendmentId) || a.resolutionNumber === snap.resolutionNumber
    );
  }

  getDeltaTitle(snap: BudgetVersionSnapshot, kind: 'revenue' | 'expense' | 'net'): string {
    const am = this.getAmendmentForSnapshot(snap);
    if (!am) return '';
    if (kind === 'revenue' && am.totalRevenueDelta) {
      const formatted =
        (am.totalRevenueDelta > 0 ? '+' : '') +
        am.totalRevenueDelta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
        ' PLN';
      return `${this.translate.instant('FINANCES.BUDGET.REVENUE_DELTA')}: ${formatted}`;
    }
    if (kind === 'expense' && am.totalExpenseDelta) {
      const formatted =
        (am.totalExpenseDelta > 0 ? '+' : '') +
        am.totalExpenseDelta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
        ' PLN';
      return `${this.translate.instant('FINANCES.BUDGET.EXPENSE_DELTA')}: ${formatted}`;
    }
    if (kind === 'net' && am.netBudgetDelta) {
      const formatted =
        (am.netBudgetDelta > 0 ? '+' : '') +
        am.netBudgetDelta.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
        ' PLN';
      return `${this.translate.instant('FINANCES.BUDGET.NET_DELTA')}: ${formatted}`;
    }
    return '';
  }

  async editSnapshot(snap: BudgetVersionSnapshot): Promise<void> {
    const isInitial = snap.type === 'INITIAL_ADOPTION';
    const header = this.translate.instant(
      isInitial ? 'FINANCES.BUDGET.EDIT_INITIAL_ADOPTION_TITLE' : 'FINANCES.BUDGET.EDIT_AMENDMENT_TITLE'
    );
    const message = this.translate.instant(
      isInitial ? 'FINANCES.BUDGET.EDIT_INITIAL_ADOPTION_DESC' : 'FINANCES.BUDGET.EDIT_AMENDMENT_DESC'
    );

    const alert = await this.alertCtrl.create({
      header,
      message,
      inputs: [
        {
          name: 'resolutionNumber',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.BUDGET.RESOLUTION_NO_PH'),
          value: snap.resolutionNumber || ''
        },
        {
          name: 'adoptedDate',
          type: 'date',
          value: snap.adoptedDate || ''
        },
        {
          name: 'description',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.MODALS.AMENDMENT.JUSTIFICATION_PH'),
          value: snap.description || ''
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data) => {
            await this.saveSnapshotChanges(snap, data);
          }
        }
      ]
    });
    await alert.present();
  }

  private async saveSnapshotChanges(
    snap: BudgetVersionSnapshot,
    data: { resolutionNumber?: string; adoptedDate?: string; description?: string }
  ): Promise<void> {
    const newRes = data.resolutionNumber?.trim() || '';
    const newDate = data.adoptedDate || '';
    const newDesc = data.description?.trim() || '';

    // Update snapshot locally
    snap.resolutionNumber = newRes;
    snap.adoptedDate = newDate;
    snap.description = newDesc;

    // Update inside budget.versionHistory
    if (this.budget?.versionHistory) {
      const found = this.budget.versionHistory.find((s) => s.id === snap.id);
      if (found) {
        found.resolutionNumber = newRes;
        found.adoptedDate = newDate;
        found.description = newDesc;
      }
    }

    if (snap.type === 'INITIAL_ADOPTION') {
      this.budget.initialResolutionNumber = newRes;
      this.budget.initialAdoptedDate = newDate;

      if (!this.budget.amendments || this.budget.amendments.length === 0) {
        this.budget.resolutionNumber = newRes;
        this.budget.adoptedDate = newDate;
      }
    } else {
      const am = this.budget.amendments?.find(
        (a) => (snap.amendmentId && a.id === snap.amendmentId) || a.resolutionNumber === snap.resolutionNumber
      );
      if (am) {
        am.resolutionNumber = newRes;
        am.adoptedDate = newDate;
        am.date = newDate;
        am.description = newDesc;
      }
      const isLatest =
        this.budget.amendments &&
        this.budget.amendments.length > 0 &&
        (this.budget.amendments[this.budget.amendments.length - 1] === am ||
          this.budget.amendments[this.budget.amendments.length - 1].resolutionNumber === newRes);
      if (isLatest) {
        this.budget.resolutionNumber = newRes;
        this.budget.adoptedDate = newDate;
      }
    }

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('FINANCES.BUDGET.SAVING')
    });
    await loading.present();

    try {
      this.budget = await this.financesService.saveBudget(this.budget);
      this.hasBudgetBeenUpdated = true;
      if (this.budget?.versionHistory) {
        this.versionHistory = [...this.budget.versionHistory].sort(
          (a, b) => new Date(b.adoptedDate || b.createdAt).getTime() - new Date(a.adoptedDate || a.createdAt).getTime()
        );
      }
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.SAVE_SUCCESS'),
        duration: 2500,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      console.error('Failed to save budget snapshot changes:', err);
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.BUDGET.SAVE_ERROR'),
        duration: 3500,
        color: 'danger'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }

  async exportSnapshot(snap: BudgetVersionSnapshot, format: 'PDF' | 'EXCEL'): Promise<void> {
    try {
      // Create a temporary AnnualBudget holding this snapshot's categories and totals
      const snapBudget = new AnnualBudget({
        ...this.budget,
        status: snap.type === 'INITIAL_ADOPTION' ? 'ADOPTED' : 'AMENDED',
        resolutionNumber: snap.resolutionNumber,
        adoptedDate: snap.adoptedDate,
        categories: snap.categories
      });
      snapBudget.recalculateTotals();

      const lang = this.app.currentLanguage === 'en' ? 'en' : 'pl';
      const orgName = {
        pl: this.app.getBudgetOrganisation('pl'),
        en: this.app.getBudgetOrganisation('en')
      };

      const numFormat = this.app.configurations?.financesConfig?.numberDisplayFormat || 'STANDARD';

      if (format === 'PDF') {
        const html = generateBudgetHtmlReport(
          snapBudget,
          'BUDGET',
          snap.adoptedDate,
          lang,
          undefined,
          'NET',
          numFormat,
          undefined,
          this.dateFormat,
          orgName
        );
        openPrintablePdf(html);
      } else {
        const csv = generateBudgetCsvContent(
          snapBudget,
          'BUDGET',
          snap.adoptedDate,
          lang,
          'NET',
          numFormat,
          undefined,
          this.dateFormat,
          orgName
        );
        downloadCsvFile(csv.filename, csv.content);
      }

      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.EXPORT_SUCCESS'),
        duration: 2500,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      console.error('Failed to export snapshot:', err);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.EXPORT_ERROR'),
        duration: 3500,
        color: 'danger'
      });
      await toast.present();
    }
  }
}

