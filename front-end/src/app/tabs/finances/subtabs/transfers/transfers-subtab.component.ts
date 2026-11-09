import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { InternalTransfer } from '@models/subledgers.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-transfers-subtab',
  templateUrl: './transfers-subtab.component.html',
  styleUrls: ['./transfers-subtab.component.scss']
})
export class TransfersSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private translate = inject(TranslateService);

  transfers: InternalTransfer[] = [];
  loading: boolean = true;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadTransfers(year);
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

  async loadTransfers(year: number): Promise<void> {
    this.loading = true;
    try {
      this.transfers = await this.financesService.getTransfers(year);
    } catch (err: any) {
      console.error('Failed to load transfers', err);
    } finally {
      this.loading = false;
    }
  }

  async addTransfer(): Promise<void> {
    if (!this.canEdit || this.isArchived) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.TRANSFERS.ALERT_ADD_TITLE'),
      inputs: [
        { name: 'date', type: 'date', value: new Date().toISOString().split('T')[0] },
        { name: 'fromBudgetCode', type: 'text', placeholder: this.translate.instant('FINANCES.TRANSFERS.FROM_LINE_PH') },
        { name: 'toBudgetCode', type: 'text', placeholder: this.translate.instant('FINANCES.TRANSFERS.TO_LINE_PH') },
        { name: 'amount', type: 'number', placeholder: this.translate.instant('FINANCES.TRANSFERS.AMOUNT_PH') },
        { name: 'justification', type: 'text', placeholder: this.translate.instant('FINANCES.TRANSFERS.JUSTIFICATION_PH') }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data) => {
            const transfer = new InternalTransfer({
              id: `tr_${Date.now()}`,
              year: this.stateService.activeYear,
              date: data.date,
              fromBudgetCode: data.fromBudgetCode || '',
              toBudgetCode: data.toBudgetCode || '',
              amount: Number(data.amount) || 0,
              justification: data.justification || '',
              approvedBy: this.app.currentUser?.userId || ''
            });
            await this.financesService.saveTransfer(transfer);
            this.transfers.push(transfer);
            const toast = await this.toastCtrl.create({
              message: this.translate.instant('FINANCES.TRANSFERS.SAVE_SUCCESS'),
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
