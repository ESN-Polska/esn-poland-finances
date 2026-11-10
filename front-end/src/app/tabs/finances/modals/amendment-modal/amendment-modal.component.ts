import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancesService } from '../../../../services/finances.service';
import {
  AnnualBudget,
  BudgetAmendment,
  BudgetAmendmentItem,
  DynamicBudgetCategory,
  BudgetLineType,
  BudgetAmendmentType
} from '@models/annual-budget.model';
import { parseLocaleNumber } from '../../../../utils/number-utils';

export interface AmendmentModalItemViewModel {
  lineId?: string;
  lineCode: string;
  lineName: string;
  categoryPath?: string;
  type: BudgetLineType;
  changeType: BudgetAmendmentType;
  previousAmount: number;
  newAmount: number;
  difference: number;
  justification: string;
}

@Component({
  selector: 'app-amendment-modal',
  templateUrl: './amendment-modal.component.html',
  styleUrls: ['./amendment-modal.component.scss']
})
export class AmendmentModalComponent implements OnInit {
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private financesService = inject(FinancesService);
  private translate = inject(TranslateService);

  @Input() budget!: AnnualBudget;
  @Input() year!: number;
  @Input() itemsDiff?: BudgetAmendmentItem[];
  @Input() draftCategories?: DynamicBudgetCategory[];
  @Input() totalRevenueDelta: number = 0;
  @Input() totalExpenseDelta: number = 0;
  @Input() netBudgetDelta: number = 0;

  resolutionNumber: string = '';
  adoptedDate: string = '';
  description: string = '';

  items: AmendmentModalItemViewModel[] = [];

  allLines: Array<{
    code: string;
    name: string;
    currentAmount: number;
    type: BudgetLineType;
  }> = [];

  ngOnInit(): void {
    if (!this.adoptedDate) {
      this.adoptedDate = this.budget?.adoptedDate || new Date().toISOString().split('T')[0];
    }
    this.populateLinesList();

    if (this.itemsDiff && this.itemsDiff.length > 0) {
      this.items = this.itemsDiff.map((it) => {
        const lineName = it.lineName?.pl || it.lineName?.en || it.budgetCode || it.lineCode || '';
        const prev = it.previousAmount ?? it.currentAmount ?? 0;
        const next = it.proposedAmount ?? it.newAmount ?? (prev + (it.deltaAmount || 0));
        const diff = it.deltaAmount ?? it.difference ?? (next - prev);
        return {
          lineId: it.lineId,
          lineCode: it.budgetCode || it.lineCode || '',
          lineName: lineName,
          categoryPath: it.categoryPath || '',
          type: (it.type === 'REVENUE' ? 'REVENUE' : 'EXPENSE') as BudgetLineType,
          changeType: it.changeType || 'MODIFY_LINE',
          previousAmount: prev,
          newAmount: next,
          difference: diff,
          justification: it.explanation || it.justification || ''
        };
      });
    } else {
      this.addNewItemRow();
    }
  }

  private populateLinesList(): void {
    if (!this.budget?.categories) return;
    const lines = typeof this.budget.getAllLines === 'function'
      ? this.budget.getAllLines()
      : new AnnualBudget(this.budget).getAllLines();

    this.allLines = lines.map(line => ({
      code: line.code,
      name: `${line.code} ${line.name?.pl || line.name?.en || ''}`,
      currentAmount: (line.plannedAmount ?? line.budgetedAmount ?? 0) + (line.amendmentsDelta || 0),
      type: line.type || 'EXPENSE'
    })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }

  addNewItemRow(): void {
    this.items.push({
      lineCode: '',
      lineName: '',
      type: 'EXPENSE',
      changeType: 'MODIFY_LINE',
      previousAmount: 0,
      newAmount: 0,
      difference: 0,
      justification: ''
    });
  }

  removeItemRow(index: number): void {
    if (this.items.length > 1) {
      this.items.splice(index, 1);
    }
  }

  onLineSelected(index: number, code: string): void {
    if (!code) return;
    const found = this.allLines.find((l) => l.code === code);
    if (found) {
      this.items[index].lineCode = found.code;
      this.items[index].lineName = found.name;
      this.items[index].type = found.type;
      this.items[index].previousAmount = found.currentAmount;
      if (!this.items[index].newAmount) {
        this.items[index].newAmount = found.currentAmount;
      }
      this.items[index].difference = this.items[index].newAmount - this.items[index].previousAmount;
    }
  }

  onNewAmountChange(index: number, newAmt: number | string | null | undefined): void {
    const val = parseLocaleNumber(newAmt) || 0;
    this.items[index].newAmount = val;
    this.items[index].difference = val - this.items[index].previousAmount;
  }

  get calculatedRevenueDelta(): number {
    if (this.totalRevenueDelta) return this.totalRevenueDelta;
    return this.items
      .filter((i) => i.type === 'REVENUE')
      .reduce((sum, i) => sum + (i.difference || 0), 0);
  }

  get calculatedExpenseDelta(): number {
    if (this.totalExpenseDelta) return this.totalExpenseDelta;
    return this.items
      .filter((i) => i.type === 'EXPENSE')
      .reduce((sum, i) => sum + (i.difference || 0), 0);
  }

  get totalDelta(): number {
    if (this.netBudgetDelta) return this.netBudgetDelta;
    return this.calculatedRevenueDelta - this.calculatedExpenseDelta;
  }

  getChangeTypeLabel(changeType?: string): string {
    switch (changeType) {
      case 'ADD_LINE':
      case 'NEW_LINE':
        return this.translate.instant('FINANCES.MODALS.AMENDMENT.CHANGE_NEW');
      case 'REMOVE_LINE':
        return this.translate.instant('FINANCES.MODALS.AMENDMENT.CHANGE_REMOVE');
      case 'RENAME_LINE':
        return this.translate.instant('FINANCES.MODALS.AMENDMENT.CHANGE_RENAME');
      case 'REORDER':
        return this.translate.instant('FINANCES.MODALS.AMENDMENT.CHANGE_REORDER');
      case 'MODIFY_LINE':
      default:
        return this.translate.instant('FINANCES.MODALS.AMENDMENT.CHANGE_MODIFY');
    }
  }

  close(): void {
    this.modalCtrl.dismiss();
  }

  async saveAmendment(): Promise<void> {
    if (!this.resolutionNumber?.trim()) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.AMENDMENT.RESOLUTION_REQUIRED'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('FINANCES.MODALS.AMENDMENT.SAVING')
    });
    await loading.present();

    try {
      let finalItems: BudgetAmendmentItem[] = [];

      if (this.itemsDiff && this.itemsDiff.length > 0) {
        finalItems = this.itemsDiff.map((diff, idx) => {
          const itemVm = this.items[idx];
          const userJustification = itemVm?.justification?.trim() || diff.explanation || diff.justification || '';
          return {
            ...diff,
            explanation: userJustification,
            justification: userJustification,
            previousAmount: diff.previousAmount ?? diff.currentAmount ?? 0,
            newAmount: diff.proposedAmount ?? diff.newAmount ?? 0,
            deltaAmount: diff.deltaAmount ?? diff.difference ?? 0,
            difference: diff.deltaAmount ?? diff.difference ?? 0
          };
        });
      } else {
        const validItems = this.items.filter((it) => it.lineCode && it.difference !== 0);
        if (validItems.length === 0) {
          await loading.dismiss();
          const toast = await this.toastCtrl.create({
            message: this.translate.instant('FINANCES.MODALS.AMENDMENT.SELECT_LINE_REQUIRED'),
            duration: 3000,
            color: 'warning'
          });
          await toast.present();
          return;
        }

        finalItems = validItems.map((it) => {
          const line = this.budget?.findLineByCode ? this.budget.findLineByCode(it.lineCode) : undefined;
          return {
            lineId: line?.id || `line_${it.lineCode}`,
            budgetCode: it.lineCode,
            lineCode: it.lineCode,
            lineName: line?.name || { pl: it.lineName || it.lineCode, en: it.lineName || it.lineCode },
            type: it.type || line?.type || 'EXPENSE',
            changeType: 'MODIFY_LINE',
            currentAmount: it.previousAmount || 0,
            proposedAmount: it.newAmount || 0,
            deltaAmount: it.difference || 0,
            explanation: it.justification || '',
            previousAmount: it.previousAmount,
            newAmount: it.newAmount,
            difference: it.difference,
            justification: it.justification
          };
        });
      }

      const revDelta = finalItems
        .filter((it) => it.type === 'REVENUE')
        .reduce((sum, it) => sum + (it.deltaAmount || 0), 0);
      const expDelta = finalItems
        .filter((it) => it.type === 'EXPENSE')
        .reduce((sum, it) => sum + (it.deltaAmount || 0), 0);
      const netDelta = revDelta - expDelta;

      const nextNum = (this.budget?.amendments?.length || 0) + 1;
      const amendment: BudgetAmendment = {
        id: `amend_${Date.now()}`,
        amendmentNumber: `${nextNum}/${this.year}`,
        resolutionNumber: this.resolutionNumber.trim(),
        date: this.adoptedDate || new Date().toISOString().substring(0, 10),
        adoptedDate: this.adoptedDate || new Date().toISOString().substring(0, 10),
        description: this.description.trim(),
        status: 'APPROVED',
        items: finalItems,
        totalRevenueDelta: revDelta,
        totalExpenseDelta: expDelta,
        netBudgetDelta: netDelta,
        createdAt: new Date().toISOString()
      };

      const updatedBudget = await this.financesService.adoptAmendment(
        this.year,
        amendment,
        this.draftCategories
      );

      await loading.dismiss();
      this.modalCtrl.dismiss({ saved: true, budget: updatedBudget });

      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.AMENDMENT_ADOPTED_SUCCESS'),
        duration: 3500,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      await loading.dismiss();
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.MODALS.AMENDMENT.SAVE_ERROR'),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    }
  }
}
