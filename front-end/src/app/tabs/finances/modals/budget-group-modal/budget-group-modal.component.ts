import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { DynamicBudgetGroup } from '@models/annual-budget.model';

@Component({
  selector: 'app-budget-group-modal',
  templateUrl: './budget-group-modal.component.html',
  styleUrls: ['./budget-group-modal.component.scss']
})
export class BudgetGroupModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private translate = inject(TranslateService);

  @Input() group?: DynamicBudgetGroup;
  @Input() categoryName: string = '';
  @Input() isNew: boolean = true;

  namePl: string = '';
  nameEn: string = '';

  ngOnInit(): void {
    if (this.group) {
      this.namePl = this.group.name?.pl || '';
      this.nameEn = this.group.name?.en || '';
    }
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  async save(): Promise<void> {
    const trimmedPl = this.namePl?.trim();
    const trimmedEn = this.nameEn?.trim();

    if (!trimmedPl && !trimmedEn) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.BUDGET_GROUP.NAME_REQUIRED'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    const updatedGroup: DynamicBudgetGroup = {
      id: this.group?.id || `grp_${Date.now()}`,
      name: {
        pl: trimmedPl || trimmedEn,
        en: trimmedEn || trimmedPl
      },
      displayOrder: this.group?.displayOrder ?? 0,
      items: this.group?.items || []
    };

    this.modalCtrl.dismiss({ group: updatedGroup });
  }
}
