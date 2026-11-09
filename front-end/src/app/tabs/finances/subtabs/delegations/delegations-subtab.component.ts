import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ToastController, AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import { DelegationRecord } from '@models/subledgers.model';
import { AppPermission } from '@models/configurations.model';

@Component({
  selector: 'app-delegations-subtab',
  templateUrl: './delegations-subtab.component.html',
  styleUrls: ['./delegations-subtab.component.scss']
})
export class DelegationsSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private toastCtrl = inject(ToastController);
  private alertCtrl = inject(AlertController);
  private translate = inject(TranslateService);

  delegations: DelegationRecord[] = [];
  loading: boolean = true;
  searchQuery: string = '';

  private subs: Subscription[] = [];

  ngOnInit(): void {
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadDelegations(year);
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

  async loadDelegations(year: number): Promise<void> {
    this.loading = true;
    try {
      this.delegations = await this.financesService.getDelegations(year);
    } catch (err: any) {
      console.error('Failed to load delegations', err);
    } finally {
      this.loading = false;
    }
  }

  get filteredDelegations(): DelegationRecord[] {
    if (!this.searchQuery.trim()) return this.delegations;
    const q = this.searchQuery.toLowerCase().trim();
    return this.delegations.filter(
      (d) =>
        d.attendeeName.toLowerCase().includes(q) ||
        d.destination?.toLowerCase().includes(q) ||
        d.purpose?.toLowerCase().includes(q)
    );
  }

  async editSplit(del: DelegationRecord): Promise<void> {
    if (!this.canEdit || this.isArchived) return;

    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.DELEGATIONS.ALERT_SPLIT_TITLE', { name: del.attendeeName }),
      subHeader: this.translate.instant('FINANCES.DELEGATIONS.ALERT_SPLIT_SUBTITLE', { amount: del.totalAmount }),
      inputs: [
        {
          name: 'travelCost',
          type: 'number',
          placeholder: this.translate.instant('FINANCES.DELEGATIONS.TRAVEL_COST_PH'),
          value: del.travelCost || 0
        },
        {
          name: 'travelBudgetCode',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.DELEGATIONS.TRAVEL_CODE_PH'),
          value: del.travelBudgetCode || ''
        },
        {
          name: 'diemAmount',
          type: 'number',
          placeholder: this.translate.instant('FINANCES.DELEGATIONS.DIEM_COST_PH'),
          value: del.diemAmount || 0
        },
        {
          name: 'diemBudgetCode',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.DELEGATIONS.DIEM_CODE_PH'),
          value: del.diemBudgetCode || ''
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('FINANCES.DELEGATIONS.SAVE_SPLIT_BTN'),
          handler: async (data) => {
            del.travelCost = Number(data.travelCost) || 0;
            del.travelBudgetCode = data.travelBudgetCode?.trim();
            del.diemAmount = Number(data.diemAmount) || 0;
            del.diemBudgetCode = data.diemBudgetCode?.trim();
            del.isSplitAssigned = true;

            await this.financesService.saveDelegation(del);
            const toast = await this.toastCtrl.create({
              message: this.translate.instant('FINANCES.DELEGATIONS.SPLIT_SUCCESS'),
              duration: 2500,
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
