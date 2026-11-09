import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { TermDeposit } from '@models/subledgers.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-deposits-subtab',
  templateUrl: './deposits-subtab.component.html',
  styleUrls: ['./deposits-subtab.component.scss']
})
export class DepositsSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private translate = inject(TranslateService);

  deposits: TermDeposit[] = [];
  loading: boolean = true;

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadDeposits(year);
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

  async loadDeposits(year: number): Promise<void> {
    this.loading = true;
    try {
      this.deposits = await this.financesService.getDeposits(year);
    } catch (err: any) {
      console.error('Failed to load deposits', err);
    } finally {
      this.loading = false;
    }
  }

  get totalPrincipal(): number {
    return this.deposits.reduce((sum, d) => sum + (d.principalAmount || 0), 0);
  }

  get totalInterest(): number {
    return this.deposits.reduce((sum, d) => sum + (d.accruedInterest || 0), 0);
  }

  async addDeposit(): Promise<void> {
    if (!this.canEdit || this.isArchived) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.DEPOSITS.ALERT_ADD_TITLE'),
      inputs: [
        { name: 'name', type: 'text', placeholder: this.translate.instant('FINANCES.DEPOSITS.NAME_PH') },
        { name: 'principalAmount', type: 'number', placeholder: this.translate.instant('FINANCES.DEPOSITS.PRINCIPAL_PH') },
        { name: 'interestRate', type: 'number', placeholder: this.translate.instant('FINANCES.DEPOSITS.RATE_PH') },
        { name: 'startDate', type: 'date', value: new Date().toISOString().split('T')[0] },
        { name: 'maturityDate', type: 'date' }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data) => {
            const deposit = new TermDeposit({
              id: `dep_${Date.now()}`,
              year: this.stateService.activeYear,
              bankName: data.name || this.translate.instant('FINANCES.DEPOSITS.DEFAULT_NAME'),
              depositNumber: `DEP-${Date.now().toString().slice(-4)}`,
              principalAmount: Number(data.principalAmount) || 0,
              currency: 'PLN',
              interestRate: Number(data.interestRate) || 0,
              startDate: data.startDate,
              maturityDate: data.maturityDate,
              capitalizedInterest: 0,
              status: 'ACTIVE'
            });
            await this.financesService.saveDeposit(deposit);
            this.deposits.push(deposit);
            const toast = await this.toastCtrl.create({
              message: this.translate.instant('FINANCES.DEPOSITS.SAVE_SUCCESS'),
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
