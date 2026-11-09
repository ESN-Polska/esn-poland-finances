import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { BudgetLineType, DynamicBudgetCategory } from '@models/annual-budget.model';

@Component({
  selector: 'app-budget-category-modal',
  templateUrl: './budget-category-modal.component.html',
  styleUrls: ['./budget-category-modal.component.scss']
})
export class BudgetCategoryModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private translate = inject(TranslateService);

  @Input() category?: DynamicBudgetCategory;
  @Input() isNew: boolean = true;
  @Input() defaultType?: BudgetLineType | 'ALL' = 'EXPENSE';
  @Input() nextNumber: number = 1;

  namePl: string = '';
  nameEn: string = '';
  includeRevenues: boolean = false;
  includeExpenses: boolean = true;
  explanationPl: string = '';
  explanationEn: string = '';

  ngOnInit(): void {
    if (this.category) {
      this.namePl = this.category.name?.pl || '';
      this.nameEn = this.category.name?.en || '';
      this.includeRevenues = !!(this.category.revenues && this.category.revenues.enabled !== false);
      this.includeExpenses = !!(this.category.expenses && this.category.expenses.enabled !== false);


      const rawExplanation = this.category.categoryResultExplanation;
      if (typeof rawExplanation === 'string') {
        this.explanationPl = rawExplanation;
        this.explanationEn = '';
      } else {
        this.explanationPl = rawExplanation?.pl || '';
        this.explanationEn = rawExplanation?.en || '';
      }
    } else {
      if (this.defaultType === 'REVENUE') {
        this.includeRevenues = true;
        this.includeExpenses = false;
      } else if (this.defaultType === 'EXPENSE') {
        this.includeRevenues = false;
        this.includeExpenses = true;
      } else {
        this.includeRevenues = true;
        this.includeExpenses = true;
      }
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
        message: this.translate.instant('FINANCES.MODALS.BUDGET_CATEGORY.NAME_REQUIRED'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    if (!this.includeRevenues && !this.includeExpenses) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.BUDGET_CATEGORY.SECTIONS_AT_LEAST_ONE'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    const updatedCategory: DynamicBudgetCategory = {
      id: this.category?.id || `cat_${Date.now()}`,
      number: this.category?.number || this.nextNumber || 1,
      name: {
        pl: trimmedPl || trimmedEn,
        en: trimmedEn || trimmedPl
      },
      displayOrder: this.category?.displayOrder ?? (this.nextNumber - 1),
      revenues: this.includeRevenues
        ? (this.category?.revenues || { enabled: true, type: 'REVENUE', items: [] })
        : undefined,
      expenses: this.includeExpenses
        ? (this.category?.expenses || { enabled: true, type: 'EXPENSE', items: [] })
        : undefined,
      categoryResultExplanation: {
        pl: this.explanationPl?.trim() || '',
        en: this.explanationEn?.trim() || ''
      }
    };

    this.modalCtrl.dismiss({ category: updatedCategory });
  }
}
