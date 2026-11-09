import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { FiscalMonthlyReport, FiscalDailyReport } from '@models/fiscal-report.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-fiscal-subtab',
  templateUrl: './fiscal-subtab.component.html',
  styleUrls: ['./fiscal-subtab.component.scss']
})
export class FiscalSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private translate = inject(TranslateService);

  reports: FiscalMonthlyReport[] = [];
  loading: boolean = true;
  selectedMonthReport: FiscalMonthlyReport | null = null;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadFiscalReports(year);
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

  async loadFiscalReports(year: number): Promise<void> {
    this.loading = true;
    try {
      this.reports = await this.financesService.getFiscalReports(year);
      if (this.reports.length > 0 && !this.selectedMonthReport) {
        this.selectedMonthReport = this.reports[0];
      }
    } catch (err: any) {
      console.error('Failed to load fiscal reports', err);
    } finally {
      this.loading = false;
    }
  }

  selectMonth(report: FiscalMonthlyReport): void {
    this.selectedMonthReport = report;
  }

  async addDailyReport(monthReport: FiscalMonthlyReport): Promise<void> {
    if (!this.canEdit || this.isArchived) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.FISCAL.ALERT_ADD_TITLE'),
      inputs: [
        { name: 'reportNumber', type: 'text', placeholder: this.translate.instant('FINANCES.FISCAL.REPORT_NO_PH') },
        { name: 'saleDate', type: 'date', value: new Date().toISOString().split('T')[0] },
        { name: 'grossAmount', type: 'number', placeholder: this.translate.instant('FINANCES.FISCAL.GROSS_PH') },
        { name: 'vatAmount', type: 'number', placeholder: this.translate.instant('FINANCES.FISCAL.VAT_PH') },
        { name: 'netAmount', type: 'number', placeholder: this.translate.instant('FINANCES.FISCAL.NET_PH') }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.ADD'),
          handler: async (data) => {
            const daily: FiscalDailyReport = {
              id: `daily_${Date.now()}`,
              reportNumber: data.reportNumber || '1',
              printDate: data.saleDate,
              saleDate: data.saleDate,
              grossAmount: Number(data.grossAmount) || 0,
              vatAmount: Number(data.vatAmount) || 0,
              netAmount: Number(data.netAmount) || 0
            };
            monthReport.dailyReports.push(daily);
            monthReport.grossTotal = monthReport.dailyReports.reduce((s, r) => s + r.grossAmount, 0);
            monthReport.vatTotal = monthReport.dailyReports.reduce((s, r) => s + r.vatAmount, 0);
            monthReport.netTotal = monthReport.dailyReports.reduce((s, r) => s + r.netAmount, 0);

            await this.financesService.saveFiscalReport(monthReport);
            const toast = await this.toastCtrl.create({
              message: this.translate.instant('FINANCES.FISCAL.ADD_SUCCESS'),
              duration: 2000,
              color: 'success'
            });
            await toast.present();
          }
        }
      ]
    });
    await alert.present();
  }
}
