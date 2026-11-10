import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, ToastController, LoadingController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { FinancesService } from '../../../../services/finances.service';
import { AnnualBudget, BudgetAmendment, BudgetAmendmentItem } from '@models/annual-budget.model';
import { parseLocaleNumber } from '../../../../utils/number-utils';

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
  @Input() totalRevenueDelta: number = 0;
  @Input() totalExpenseDelta: number = 0;
  @Input() netBudgetDelta: number = 0;

  resolutionNumber: string = '';
  adoptedDate: string = '';
  description: string = '';

  items: Array<{
    lineCode: string;
    lineName: string;
    previousAmount: number;
    newAmount: number;
    difference: number;
    justification: string;
  }> = [];

  allLines: Array<{ code: string; name: string; currentAmount: number }> = [];

  ngOnInit(): void {
    this.adoptedDate = new Date().toISOString().split('T')[0];
    if (this.itemsDiff && this.itemsDiff.length > 0) {
      this.items = this.itemsDiff.map((it) => ({
        lineCode: it.budgetCode || it.lineCode || '',
        lineName: it.lineName?.pl || it.lineName?.en || it.budgetCode || '',
        previousAmount: it.previousAmount || it.currentAmount || 0,
        newAmount: it.proposedAmount ?? ((it.previousAmount || it.currentAmount || 0) + (it.deltaAmount || 0)),
        difference: it.deltaAmount ?? ((it.proposedAmount || 0) - (it.previousAmount || 0)),
        justification: it.explanation || it.justification || ''
      }));
    } else {
      this.populateLinesList();
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
      currentAmount: (line.plannedAmount ?? line.budgetedAmount ?? 0) + (line.amendmentsDelta || 0)
    })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }

  addNewItemRow(): void {
    this.items.push({
      lineCode: '',
      lineName: '',
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
    const found = this.allLines.find((l) => l.code === code);
    if (found) {
      this.items[index].lineCode = found.code;
      this.items[index].lineName = found.name;
      this.items[index].previousAmount = found.currentAmount;
      this.items[index].newAmount = found.currentAmount;
      this.items[index].difference = 0;
    }
  }

  onNewAmountChange(index: number, newAmt: number | string | null | undefined): void {
    const val = parseLocaleNumber(newAmt) || 0;
    this.items[index].newAmount = val;
    this.items[index].difference = val - this.items[index].previousAmount;
  }

  get totalDelta(): number {
    return this.items.reduce((sum, item) => sum + (item.difference || 0), 0);
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

    if (this.itemsDiff && this.itemsDiff.length > 0) {
      this.modalCtrl.dismiss({
        confirmed: true,
        resolutionNumber: this.resolutionNumber.trim(),
        adoptedDate: this.adoptedDate || new Date().toISOString().substring(0, 10),
        description: this.description.trim()
      });
      return;
    }

    const validItems: BudgetAmendmentItem[] = this.items
      .filter((it) => it.lineCode && it.difference !== 0)
      .map((it) => {
        const line = this.budget?.findLineByCode ? this.budget.findLineByCode(it.lineCode) : undefined;
        return {
          lineId: line?.id || `line_${it.lineCode}`,
          budgetCode: it.lineCode,
          lineCode: it.lineCode,
          lineName: line?.name || { pl: it.lineName || it.lineCode, en: it.lineName || it.lineCode },
          type: line?.type || 'EXPENSE',
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

    if (validItems.length === 0) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.AMENDMENT.SELECT_LINE_REQUIRED'),
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
      const amendment: BudgetAmendment = {
        id: `amend_${Date.now()}`,
        amendmentNumber: `${this.budget?.amendments?.length ? this.budget.amendments.length + 1 : 1}/${this.year}`,
        resolutionNumber: this.resolutionNumber.trim(),
        date: this.adoptedDate || new Date().toISOString().substring(0, 10),
        adoptedDate: this.adoptedDate,
        description: this.description.trim(),
        status: 'APPROVED',
        items: validItems,
        totalRevenueDelta: validItems
          .filter((it) => it.type === 'REVENUE')
          .reduce((sum, it) => sum + (it.deltaAmount || 0), 0),
        totalExpenseDelta: validItems
          .filter((it) => it.type === 'EXPENSE')
          .reduce((sum, it) => sum + (it.deltaAmount || 0), 0),
        netBudgetDelta: 0,
        createdAt: new Date().toISOString()
      };
      amendment.netBudgetDelta = amendment.totalRevenueDelta - amendment.totalExpenseDelta;

      const updatedBudget = await this.financesService.addAmendment(this.year, amendment);
      await loading.dismiss();
      this.modalCtrl.dismiss({ saved: true, budget: updatedBudget });

      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.AMENDMENT.SAVE_SUCCESS'),
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
