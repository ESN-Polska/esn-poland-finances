import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancesService, BudgetExportOptions } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { AnnualBudget } from '@models/annual-budget.model';
import {
  generateBudgetCsvContent,
  downloadCsvFile,
  generateBudgetHtmlReport,
  openPrintablePdf,
  CurrentBankBalances,
  computeCurrentBankBalances,
  fetchNbpEurRateBeforeToday,
  fetchNbpEurRateOnOrBefore
} from '../../subtabs/budget/budget-export.util';

@Component({
  selector: 'app-budget-export-modal',
  templateUrl: './budget-export-modal.component.html',
  styleUrls: ['./budget-export-modal.component.scss']
})
export class BudgetExportModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private translate = inject(TranslateService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);

  @Input() budget!: AnnualBudget;
  @Input() year!: number;
  @Input() currentBalances?: CurrentBankBalances;

  exportType: 'BUDGET' | 'EXECUTION' = 'BUDGET';
  exportFormat: 'PDF' | 'EXCEL' = 'PDF';
  exportLanguage: 'pl' | 'en' | 'both' = 'pl';
  asOfDate: string = '';
  isExporting: boolean = false;
  cachedTxs: any[] = [];
  cachedDeposits: any[] = [];

  previousYearBudget: AnnualBudget | null = null;
  canComparePreviousYear: boolean = false;
  compareWithPreviousYear: boolean = false;
  isLoadingPrevBudget: boolean = false;

  async ngOnInit(): Promise<void> {
    const today = new Date();
    this.asOfDate = today.toISOString().split('T')[0];
    const curLang = this.translate.currentLang;
    if (curLang === 'en' || curLang === 'pl') {
      this.exportLanguage = curLang;
    }

    const prevYr = (this.year || this.budget?.year) - 1;
    if (prevYr >= 2000) {
      this.isLoadingPrevBudget = true;
      this.financesService
        .getBudget(prevYr)
        .then((prev) => {
          if (prev && (prev.categories?.length || (typeof prev.getAllLines === 'function' && prev.getAllLines().length))) {
            this.previousYearBudget = prev;
            this.canComparePreviousYear = true;
            if (this.budget?.status === 'DRAFT') {
              this.compareWithPreviousYear = true;
            }
          }
        })
        .catch(() => {
          this.previousYearBudget = null;
          this.canComparePreviousYear = false;
        })
        .finally(() => {
          this.isLoadingPrevBudget = false;
        });
    }

    try {
      const [txs, deposits] = await Promise.all([
        this.financesService.getTransactions(this.year || this.budget?.year).catch(() => []),
        this.financesService.getDeposits(this.year || this.budget?.year).catch(() => [])
      ]);
      this.cachedTxs = txs || [];
      this.cachedDeposits = deposits || [];

      if (!this.currentBalances && this.budget) {
        const nbpCurrent = await fetchNbpEurRateBeforeToday().catch(() => null);
        this.currentBalances = computeCurrentBankBalances(this.budget, this.cachedTxs, this.cachedDeposits, nbpCurrent);
      }
    } catch (e) {
      if (!this.currentBalances && this.budget) {
        this.currentBalances = computeCurrentBankBalances(this.budget);
      }
    }
  }

  setPresetDate(preset: 'TODAY' | 'Q1' | 'SEMI' | 'Q3' | 'YEAR_END'): void {
    const yr = this.year || new Date().getFullYear();
    switch (preset) {
      case 'TODAY':
        this.asOfDate = new Date().toISOString().split('T')[0];
        break;
      case 'Q1':
        this.asOfDate = `${yr}-03-31`;
        break;
      case 'SEMI':
        this.asOfDate = `${yr}-06-30`;
        break;
      case 'Q3':
        this.asOfDate = `${yr}-09-30`;
        break;
      case 'YEAR_END':
        this.asOfDate = `${yr}-12-31`;
        break;
    }
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  async triggerExport(): Promise<void> {
    if (this.isExporting) return;
    this.isExporting = true;
    try {
      const options: BudgetExportOptions = {
        format: this.exportFormat,
        type: this.exportType,
        asOfDate: this.exportType === 'EXECUTION' ? this.asOfDate : undefined,
        language: this.exportLanguage
      };

      const calcMode = this.app.configurations?.financesConfig?.budgetExecutionCalculationMode || 'NET';
      const numFormat = this.app.configurations?.financesConfig?.numberDisplayFormat || 'STANDARD';

      let exportBalances = this.currentBalances;
      if (this.exportType === 'EXECUTION') {
        const targetCutoff = this.asOfDate || new Date().toISOString().split('T')[0];
        const nbpRate = await fetchNbpEurRateOnOrBefore(targetCutoff);
        let txs = this.cachedTxs;
        let deposits = this.cachedDeposits;
        if (!txs || txs.length === 0) {
          txs = await this.financesService.getTransactions(this.year || this.budget?.year).catch(() => []);
          this.cachedTxs = txs;
        }
        if (!deposits || deposits.length === 0) {
          deposits = await this.financesService.getDeposits(this.year || this.budget?.year).catch(() => []);
          this.cachedDeposits = deposits;
        }
        exportBalances = computeCurrentBankBalances(
          this.budget,
          txs,
          deposits,
          nbpRate,
          targetCutoff
        );
      }

      const dateFormat = this.app.dateFormat;
      const budgetOrgName = this.app.configurations?.financesConfig?.budgetOrganisationName;
      const prevBudgetToCompare =
        this.exportType === 'BUDGET' && this.compareWithPreviousYear ? this.previousYearBudget : null;

      if (this.exportFormat === 'EXCEL') {
        const { content, filename } = generateBudgetCsvContent(
          this.budget,
          this.exportType,
          this.asOfDate,
          this.exportLanguage,
          calcMode,
          numFormat,
          exportBalances,
          dateFormat,
          budgetOrgName,
          prevBudgetToCompare
        );
        downloadCsvFile(content, filename);
      } else {
        const logoUrl = this.app.getOrganisationLogo();
        const html = generateBudgetHtmlReport(
          this.budget,
          this.exportType,
          this.asOfDate,
          this.exportLanguage,
          logoUrl,
          calcMode,
          numFormat,
          exportBalances,
          dateFormat,
          budgetOrgName,
          prevBudgetToCompare
        );
        const opened = openPrintablePdf(html);
        if (!opened) {
          // If popup blocker intervened, fallback to direct downloadable HTML file
          const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.setAttribute('href', url);
          link.setAttribute('download', `budzet_${this.year || ''}_${this.exportType.toLowerCase()}_${this.exportLanguage}.html`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        }
      }

      await this.modalCtrl.dismiss({ exported: true });
    } catch (err: any) {
      console.error('Export error:', err);
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.MODALS.BUDGET_EXPORT.EXPORT_ERROR'),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      this.isExporting = false;
    }
  }
}
