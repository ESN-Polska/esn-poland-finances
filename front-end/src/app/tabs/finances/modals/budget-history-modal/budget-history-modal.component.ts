import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { AnnualBudget, BudgetVersionSnapshot } from '@models/annual-budget.model';
import { DateFormatOption, DEFAULT_DATE_FORMAT } from '@models/configurations.model';
import { formatDateOption } from '../../../../utils/date-utils';
import {
  generateBudgetCsvContent,
  generateBudgetHtmlReport,
  downloadCsvFile,
  openPrintablePdf
} from '../../subtabs/budget/budget-export.util';
import { AppService } from '../../../../app.service';

@Component({
  selector: 'app-budget-history-modal',
  templateUrl: './budget-history-modal.component.html',
  styleUrls: ['./budget-history-modal.component.scss']
})
export class BudgetHistoryModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private translate = inject(TranslateService);
  public app = inject(AppService);

  @Input() budget!: AnnualBudget;
  @Input() activeSnapshotId?: string;

  versionHistory: BudgetVersionSnapshot[] = [];
  dateFormat: DateFormatOption = DEFAULT_DATE_FORMAT;

  ngOnInit(): void {
    if (this.budget?.versionHistory) {
      // Sort newest to oldest
      this.versionHistory = [...this.budget.versionHistory].sort(
        (a, b) => new Date(b.adoptedDate || b.createdAt).getTime() - new Date(a.adoptedDate || a.createdAt).getTime()
      );
    }
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  formatDate(dateStr?: string): string {
    return formatDateOption(dateStr, this.dateFormat);
  }

  viewSnapshot(snap: BudgetVersionSnapshot): void {
    this.modalCtrl.dismiss({
      action: 'VIEW_SNAPSHOT',
      snapshot: snap
    });
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

      if (format === 'PDF') {
        const html = generateBudgetHtmlReport(
          snapBudget,
          'BUDGET',
          snap.adoptedDate,
          lang,
          undefined,
          'NET',
          'STANDARD',
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
          'STANDARD',
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

