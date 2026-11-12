import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { BudgetLineItem, BudgetLineType } from '@models/annual-budget.model';
import { parseLocaleNumber } from '../../../../utils/number-utils';

@Component({
  selector: 'app-budget-line-modal',
  templateUrl: './budget-line-modal.component.html',
  styleUrls: ['./budget-line-modal.component.scss']
})
export class BudgetLineModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private translate = inject(TranslateService);

  @Input() lineItem?: BudgetLineItem;
  @Input() groupCodePrefix: string = '';
  @Input() existingCodes: string[] = [];
  @Input() lineType?: BudgetLineType;
  @Input() isNew: boolean = true;
  @Input() isAmending: boolean = false;
  @Input() currentApprovedAmount: number = 0;
  @Input() initialJustification: string = '';

  code: string = '';
  namePl: string = '';
  nameEn: string = '';
  plannedAmount: any = 0;
  descriptionPl: string = '';
  descriptionEn: string = '';
  notes: string = '';
  justification: string = '';

  get proposedDiff(): number {
    const prop = parseLocaleNumber(this.plannedAmount) || 0;
    return prop - (this.currentApprovedAmount || 0);
  }

  ngOnInit(): void {
    if (this.lineItem) {
      this.code = this.lineItem.code;
      this.namePl = this.lineItem.name?.pl || '';
      this.nameEn = this.lineItem.name?.en || '';
      this.plannedAmount = this.lineItem.plannedAmount || 0;
      this.descriptionPl = this.lineItem.description?.pl || '';
      this.descriptionEn = this.lineItem.description?.en || '';
      this.notes = this.lineItem.notes || '';
    } else {
      this.code = '';
    }
    if (this.initialJustification) {
      this.justification = this.initialJustification;
    }
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  async save(): Promise<void> {
    const trimmedCode = this.code?.trim();
    if (!trimmedCode) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.BUDGET_LINE.CODE_REQUIRED'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    if (this.isNew && this.existingCodes.includes(trimmedCode)) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.BUDGET_LINE.CODE_EXISTS', { code: trimmedCode }),
        duration: 3500,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    if (!this.namePl?.trim() && !this.nameEn?.trim()) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.BUDGET_LINE.NAME_REQUIRED'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    const resultLine: BudgetLineItem = {
      code: trimmedCode,
      type: this.lineType || this.lineItem?.type || 'EXPENSE',
      name: {
        pl: this.namePl.trim(),
        en: this.nameEn.trim()
      },
      plannedAmount: parseLocaleNumber(this.plannedAmount) || 0,
      amendmentsDelta: this.lineItem?.amendmentsDelta || 0,
      actualAmount: this.lineItem?.actualAmount || 0,
      description: {
        pl: this.descriptionPl.trim(),
        en: this.descriptionEn.trim()
      },
      notes: this.notes.trim()
    };

    this.modalCtrl.dismiss({ line: resultLine, justification: this.justification });
  }
}
