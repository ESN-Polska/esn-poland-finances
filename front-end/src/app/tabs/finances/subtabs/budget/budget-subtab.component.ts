import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { ModalController, ToastController, LoadingController, AlertController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { FinancesStateService } from '../../../../services/finances-state.service';
import { FinancesNavigationService } from '../../../../services/finances-navigation.service';
import { FinancesService } from '../../../../services/finances.service';
import { AppService } from '../../../../app.service';
import {
  AnnualBudget,
  DynamicBudgetCategory,
  CategorySection,
  DynamicBudgetGroup,
  BudgetLineItem,
  BudgetLineType,
  isBudgetGroup,
  isBudgetLine
} from '@models/annual-budget.model';
import { BankTransactionRecord } from '@models/cashflow-transaction.model';
import { TermDeposit } from '@models/subledgers.model';
import { AppPermission } from '@models/configurations.model';
import { BudgetExportModalComponent } from '../../modals/budget-export-modal/budget-export-modal.component';
import { AmendmentModalComponent } from '../../modals/amendment-modal/amendment-modal.component';
import { BudgetLineModalComponent } from '../../modals/budget-line-modal/budget-line-modal.component';
import { BudgetCategoryModalComponent } from '../../modals/budget-category-modal/budget-category-modal.component';
import { BudgetGroupModalComponent } from '../../modals/budget-group-modal/budget-group-modal.component';
import { parseLocaleNumber } from '../../../../utils/number-utils';
import { CurrentBankBalances, computeCurrentBankBalances, fetchNbpEurRateBeforeToday } from './budget-export.util';

@Component({
  selector: 'app-budget-subtab',
  templateUrl: './budget-subtab.component.html',
  styleUrls: ['./budget-subtab.component.scss']
})
export class BudgetSubtabComponent implements OnInit, OnDestroy {
  public stateService = inject(FinancesStateService);
  public navService = inject(FinancesNavigationService);
  private financesService = inject(FinancesService);
  public app = inject(AppService);
  private modalCtrl = inject(ModalController);
  private toastCtrl = inject(ToastController);
  private loadingCtrl = inject(LoadingController);
  private alertCtrl = inject(AlertController);
  private translate = inject(TranslateService);

  budget: AnnualBudget | null = null;
  loading: boolean = true;
  searchQuery: string = '';
  selectedTypeFilter: 'ALL' | 'REVENUE' | 'EXPENSE' = 'ALL';
  highlightedLineCode: string | null = null;

  isEditingOpeningBalances: boolean = false;
  isLoadingNbpRate: boolean = false;
  editingOpeningBalances = {
    bankPln: 0,
    bankEur: 0,
    bankEurInPln: 0,
    eurExchangeRate: 0,
    eurExchangeDate: '',
    termDepositsPln: 0
  };

  cachedTxs: BankTransactionRecord[] = [];
  cachedDeposits: TermDeposit[] = [];
  cachedCurrentNbpRate: { rate: number; date: string } | null = null;
  currentBalances: CurrentBankBalances | null = null;

  formatDate(date: string | Date | number | null | undefined): string {
    return this.app.formatDate(date);
  }

  isGroup(item: any): boolean {
    return isBudgetGroup(item);
  }

  isLine(item: any): boolean {
    return isBudgetLine(item);
  }

  asGroup(item: any): DynamicBudgetGroup {
    return item as DynamicBudgetGroup;
  }

  asLine(item: any): BudgetLineItem {
    return item as BudgetLineItem;
  }

  private subs: Subscription[] = [];

  ngOnInit(): void {
    // Listen to year changes
    this.subs.push(
      this.stateService.activeYear$.subscribe((year) => {
        this.loadBudget(year);
      })
    );

    // Listen to jump target
    this.subs.push(
      this.navService.jumpTarget$.subscribe((target) => {
        if (target?.subtab === 'BUDGET' && target.code) {
          this.highlightedLineCode = target.code;
          setTimeout(() => {
            const el = document.getElementById(`line-${target.code}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 400);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  async loadBudget(year: number): Promise<void> {
    this.loading = true;
    try {
      const [budget, txs, deposits, nbpCurrent] = await Promise.all([
        this.financesService.getBudget(year),
        this.financesService.getTransactions(year).catch(() => []),
        this.financesService.getDeposits(year).catch(() => []),
        fetchNbpEurRateBeforeToday().catch(() => null)
      ]);
      this.budget = budget;
      this.cachedTxs = txs || [];
      this.cachedDeposits = deposits || [];
      this.cachedCurrentNbpRate = nbpCurrent;
      await this.initOpeningBalancesState();
      this.recomputeCurrentBalances();
    } catch (err: any) {
      if (
        err?.status === 404 ||
        err?.statusCode === 404 ||
        err?.error?.status === 404 ||
        err?.error?.statusCode === 404 ||
        err?.message?.includes('not found') ||
        err?.message?.includes('404')
      ) {
        this.budget = null;
      } else {
        console.error('Failed to load annual budget', err);
        const toast = await this.toastCtrl.create({
          message: this.translate.instant('FINANCES.BUDGET.LOAD_ERROR', { year }),
          duration: 3500,
          color: 'danger'
        });
        await toast.present();
      }
    } finally {
      this.loading = false;
    }
  }

  async createNewBudget(): Promise<void> {
    const year = this.stateService.activeYear;
    const orgPl = this.app.getBudgetOrganisation('pl');
    const orgEn = this.app.getBudgetOrganisation('en');
    const newBudget = new AnnualBudget({
      year,
      title: {
        pl: `Budżet ${orgPl} ${year}`,
        en: `${orgEn} Annual Budget ${year}`
      },
      status: 'DRAFT',
      categories: [],
      amendments: []
    });
    newBudget.recalculateTotals();

    const nbp = await this.fetchNbpEurRateForYear(year);
    if (nbp) {
      newBudget.openingBalances.eurExchangeRate = nbp.rate;
      newBudget.openingBalances.eurExchangeDate = nbp.date;
    }

    this.budget = newBudget;
    await this.initOpeningBalancesState();
    await this.saveBudgetChanges();
  }

  async cloneBudgetFromPreviousYear(): Promise<void> {
    const targetYear = this.stateService.activeYear;
    const sourceYear = targetYear - 1;

    const loading = await this.loadingCtrl.create({
      message: this.translate.instant('FINANCES.BUDGET.CLONING_PROGRESS', { sourceYear, targetYear })
    });
    await loading.present();

    try {
      const source = await this.financesService.getBudget(sourceYear);
      if (!source || !source.categories || source.categories.length === 0) {
        await loading.dismiss();
        const alert = await this.alertCtrl.create({
          header: this.translate.instant('FINANCES.BUDGET.CLONE_NO_SOURCE_TITLE'),
          message: this.translate.instant('FINANCES.BUDGET.CLONE_NO_SOURCE_MSG', { sourceYear }),
          buttons: [
            { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
            {
              text: this.translate.instant('FINANCES.BUDGET.CREATE_BLANK_BUDGET_BTN', { year: targetYear }),
              handler: () => {
                this.createNewBudget();
              }
            }
          ]
        });
        await alert.present();
        return;
      }

      const cloneNode = (item: any): any => {
        if (isBudgetGroup(item)) {
          return {
            id: `grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: { pl: item.name?.pl || '', en: item.name?.en || '' },
            displayOrder: item.displayOrder ?? 0,
            items: (item.items || []).map((ch: any) => cloneNode(ch))
          };
        } else {
          return {
            id: `line_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            code: item.code || '',
            name: { pl: item.name?.pl || '', en: item.name?.en || '' },
            description: { pl: item.description?.pl || '', en: item.description?.en || '' },
            type: item.type,
            budgetedAmount: item.budgetedAmount || item.plannedAmount || 0,
            plannedAmount: item.budgetedAmount || item.plannedAmount || 0,
            actualAmount: 0,
            variance: item.budgetedAmount || item.plannedAmount || 0,
            executionPercentage: 0,
            amendmentsDelta: 0,
            notes: '',
            displayOrder: item.displayOrder ?? 0,
            isActive: item.isActive !== false
          };
        }
      };

      const clonedCategories = (source.categories || []).map((cat, cIdx) => ({
        id: `cat_${cIdx + 1}`,
        number: cIdx + 1,
        name: { pl: cat.name?.pl || '', en: cat.name?.en || '' },
        displayOrder: cIdx,
        categoryResultExplanation: { pl: '', en: '' },
        revenues: cat.revenues
          ? {
              enabled: cat.revenues.enabled !== false,
              type: 'REVENUE' as BudgetLineType,
              items: (cat.revenues.items || []).map((it) => cloneNode(it))
            }
          : undefined,
        expenses: cat.expenses
          ? {
              enabled: cat.expenses.enabled !== false,
              type: 'EXPENSE' as BudgetLineType,
              items: (cat.expenses.items || []).map((it) => cloneNode(it))
            }
          : undefined
      }));

      const nbp = await this.fetchNbpEurRateForYear(targetYear);
      const orgPl = this.app.getBudgetOrganisation('pl');
      const orgEn = this.app.getBudgetOrganisation('en');

      const newBudget = new AnnualBudget({
        year: targetYear,
        title: {
          pl: `Budżet ${orgPl} ${targetYear}`,
          en: `${orgEn} Annual Budget ${targetYear}`
        },
        status: 'DRAFT',
        resolutionNumber: '',
        adoptedDate: '',
        currency: 'PLN',
        categories: clonedCategories,
        openingBalances: {
          bankPln: 0,
          bankPlnStartingBalance: 0,
          bankEurStartingBalance: 0,
          bankEurInPln: 0,
          eurExchangeRate: nbp?.rate || 0,
          eurExchangeDate: nbp?.date || '',
          termDepositsPln: 0,
          termDepositsStartingBalance: 0,
          totalOpeningBalance: 0
        },
        amendments: []
      });

      newBudget.recalculateTotals();
      this.budget = newBudget;
      await this.initOpeningBalancesState();
      await this.saveBudgetChanges();

      await loading.dismiss();
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.CLONE_SUCCESS', { sourceYear }),
        duration: 3000,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      await loading.dismiss();
      console.error('Failed to clone budget', err);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.CLONE_ERROR', { sourceYear }),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    }
  }

  // ==========================================
  // ADOPTION ALERT
  // ==========================================

  async openAdoptBudgetAlert(): Promise<void> {
    if (!this.budget) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.BUDGET.ADOPT_MODAL_TITLE'),
      message: this.translate.instant('FINANCES.BUDGET.ADOPT_MODAL_DESC', { year: this.budget.year }),
      inputs: [
        {
          name: 'resolutionNumber',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.BUDGET.RESOLUTION_NO_PH'),
          value: this.budget.resolutionNumber || ''
        },
        {
          name: 'adoptedDate',
          type: 'date',
          value: this.budget.adoptedDate || new Date().toISOString().substring(0, 10)
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('FINANCES.BUDGET.ADOPT_BTN_CONFIRM'),
          handler: async (data) => {
            if (!this.budget) return;
            if (!data.resolutionNumber?.trim()) {
              const toast = await this.toastCtrl.create({
                message: this.translate.instant('FINANCES.BUDGET.RESOLUTION_REQUIRED'),
                duration: 2500,
                color: 'warning'
              });
              await toast.present();
              return false;
            }
            this.budget.resolutionNumber = data.resolutionNumber.trim();
            this.budget.adoptedDate = data.adoptedDate || new Date().toISOString().substring(0, 10);
            this.budget.status = 'ADOPTED';
            await this.saveBudgetChanges();
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  async openEditAdoptionAlert(): Promise<void> {
    if (!this.budget) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.BUDGET.EDIT_ADOPTION_TITLE'),
      message: this.translate.instant('FINANCES.BUDGET.EDIT_ADOPTION_DESC'),
      inputs: [
        {
          name: 'resolutionNumber',
          type: 'text',
          placeholder: this.translate.instant('FINANCES.BUDGET.RESOLUTION_NO_PH'),
          value: this.budget.resolutionNumber || ''
        },
        {
          name: 'adoptedDate',
          type: 'date',
          value: this.budget.adoptedDate || ''
        }
      ],
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('FINANCES.BUDGET.REVERT_TO_DRAFT'),
          role: 'destructive',
          handler: async () => {
            if (!this.budget) return;
            this.budget.status = 'DRAFT';
            await this.saveBudgetChanges();
          }
        },
        {
          text: this.translate.instant('COMMON.SAVE'),
          handler: async (data) => {
            if (!this.budget) return;
            this.budget.resolutionNumber = data.resolutionNumber?.trim() || '';
            this.budget.adoptedDate = data.adoptedDate || '';
            await this.saveBudgetChanges();
          }
        }
      ]
    });
    await alert.present();
  }

  private async initOpeningBalancesState(): Promise<void> {
    if (this.budget?.openingBalances) {
      const bEur = this.budget.openingBalances.bankEurStartingBalance || 0;
      let rate = this.budget.openingBalances.eurExchangeRate || 0;
      let date = this.budget.openingBalances.eurExchangeDate || '';

      if (this.budget.year) {
        const nbp = await this.fetchNbpEurRateForYear(this.budget.year);
        if (nbp) {
          rate = nbp.rate;
          date = nbp.date;
        }
      }

      const bEurInPln = rate > 0 && bEur > 0
        ? Math.round(bEur * rate * 100) / 100
        : (this.budget.openingBalances.bankEurInPln || 0);

      this.editingOpeningBalances = {
        bankPln: this.budget.openingBalances.bankPln || this.budget.openingBalances.bankPlnStartingBalance || 0,
        bankEur: bEur,
        bankEurInPln: bEurInPln,
        eurExchangeRate: rate,
        eurExchangeDate: date,
        termDepositsPln: this.budget.openingBalances.termDepositsPln || this.budget.openingBalances.termDepositsStartingBalance || 0
      };

      if (rate) {
        this.budget.openingBalances.eurExchangeRate = rate;
        this.budget.openingBalances.eurExchangeDate = date;
        this.budget.openingBalances.bankEurInPln = bEurInPln;
        this.budget.openingBalances.totalOpeningBalance =
          (this.budget.openingBalances.bankPln || 0) + bEurInPln + (this.budget.openingBalances.termDepositsPln || 0);
      }
    }
    this.recomputeCurrentBalances();
  }

  recomputeCurrentBalances(): void {
    if (this.budget) {
      this.currentBalances = computeCurrentBankBalances(
        this.budget,
        this.cachedTxs,
        this.cachedDeposits,
        this.cachedCurrentNbpRate
      );
    } else {
      this.currentBalances = null;
    }
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

  // ==========================================
  // METRICS COMPUTATIONS
  // ==========================================

  get totalPlannedRevenue(): number {
    return this.budget?.totalPlannedRevenue || 0;
  }

  get totalActualRevenue(): number {
    return this.budget?.totalActualRevenue || 0;
  }

  get revenueExecutionPct(): number {
    if (!this.totalPlannedRevenue) return 0;
    return (this.totalActualRevenue / this.totalPlannedRevenue) * 100;
  }

  get totalPlannedExpenses(): number {
    return this.budget?.totalPlannedExpenses || 0;
  }

  get totalActualExpenses(): number {
    return this.budget?.totalActualExpenses || 0;
  }

  get expensesExecutionPct(): number {
    if (!this.totalPlannedExpenses) return 0;
    return (this.totalActualExpenses / this.totalPlannedExpenses) * 100;
  }

  get plannedResult(): number {
    return this.budget?.plannedNetResult || 0;
  }

  get actualResult(): number {
    return this.budget?.actualNetResult || 0;
  }

  get resultExecutionPct(): number | null {
    if (!this.plannedResult) return null;
    return (this.actualResult / this.plannedResult) * 100;
  }

  get budgetTitle(): string {
    const isEn = this.app.currentLanguage === 'en';
    const orgPl = this.app.getBudgetOrganisation('pl');
    const orgEn = this.app.getBudgetOrganisation('en');
    const yr = this.budget?.year || this.stateService.activeYear;

    const saved = isEn ? this.budget?.title?.en : this.budget?.title?.pl;
    if (!saved || saved.includes('Annual Budget') || saved.startsWith('Budżet ')) {
      return isEn ? `${orgEn} Annual Budget ${yr}` : `Budżet ${orgPl} ${yr}`;
    }
    return saved;
  }

  getCategoryResultExecutionPct(category: DynamicBudgetCategory): number | null {
    const plan = category.plannedNetResult ?? ((category.totalPlannedRevenue || 0) - (category.totalPlannedExpense || 0));
    const act = category.actualNetResult ?? ((category.totalActualRevenue || 0) - (category.totalActualExpense || 0));
    if (!plan || plan === 0) return null;
    return (act / plan) * 100;
  }

  get isGrossCalculationMode(): boolean {
    return this.app.configurations?.financesConfig?.budgetExecutionCalculationMode === 'GROSS';
  }

  get totalOpeningBalance(): number {
    return this.budget?.openingBalances?.totalOpeningBalance || 0;
  }

  // ==========================================
  // FILTERING & SEARCH
  // ==========================================

  get filteredCategories(): DynamicBudgetCategory[] {
    if (!this.budget?.categories) return [];
    let list = this.budget.categories;

    if (this.selectedTypeFilter === 'REVENUE') {
      list = list.filter((c) => c.revenues && c.revenues.enabled !== false && (c.revenues.items.length > 0 || (c.totalPlannedRevenue || 0) > 0));
    } else if (this.selectedTypeFilter === 'EXPENSE') {
      list = list.filter((c) => c.expenses && c.expenses.enabled !== false && (c.expenses.items.length > 0 || (c.totalPlannedExpense || 0) > 0));
    }

    if (!this.searchQuery.trim()) {
      return list;
    }

    const q = this.searchQuery.toLowerCase().trim();
    return list.filter((cat) => {
      const catNamePl = cat.name?.pl?.toLowerCase() || '';
      const catNameEn = cat.name?.en?.toLowerCase() || '';
      if (catNamePl.includes(q) || catNameEn.includes(q) || String(cat.number).includes(q)) {
        return true;
      }
      const checkItems = (items: (DynamicBudgetGroup | BudgetLineItem)[]): boolean => {
        for (const it of items || []) {
          if (isBudgetLine(it)) {
            if (
              it.code?.toLowerCase().includes(q) ||
              it.name?.pl?.toLowerCase().includes(q) ||
              it.name?.en?.toLowerCase().includes(q) ||
              it.notes?.toLowerCase().includes(q) ||
              it.description?.pl?.toLowerCase().includes(q) ||
              it.description?.en?.toLowerCase().includes(q)
            ) {
              return true;
            }
          } else if (isBudgetGroup(it)) {
            if (
              (it.code && it.code.toLowerCase().includes(q)) ||
              it.name?.pl?.toLowerCase().includes(q) ||
              it.name?.en?.toLowerCase().includes(q)
            ) {
              return true;
            }
            if (checkItems(it.items || [])) return true;
          }
        }
        return false;
      };

      if (cat.revenues?.items && checkItems(cat.revenues.items)) return true;
      if (cat.expenses?.items && checkItems(cat.expenses.items)) return true;
      return false;
    });
  }

  get openAccordionValues(): string[] {
    return this.filteredCategories.map((c) => c.id);
  }

  clearSearch(): void {
    this.searchQuery = '';
  }

  getAllExistingCodes(): string[] {
    if (!this.budget) return [];
    return this.budget.getAllLines().map((l) => l.code);
  }

  getAllExistingGroupCodes(): string[] {
    if (!this.budget?.categories) return [];
    const codes: string[] = [];
    const collect = (items: (DynamicBudgetGroup | BudgetLineItem)[]) => {
      for (const it of items || []) {
        if (isBudgetGroup(it)) {
          if (it.code) codes.push(it.code);
          collect(it.items || []);
        }
      }
    };
    for (const cat of this.budget.categories) {
      if (cat.revenues?.items) collect(cat.revenues.items);
      if (cat.expenses?.items) collect(cat.expenses.items);
    }
    return codes;
  }

  // ==========================================
  // DRAG AND DROP REORDERING HANDLERS
  // ==========================================

  /**
   * Tier 1: Reordering entire categories via drag-and-drop
   */
  onDropCategory(event: CdkDragDrop<DynamicBudgetCategory[]>): void {
    if (!this.budget?.categories) return;
    moveItemInArray(this.budget.categories, event.previousIndex, event.currentIndex);
    this.budget.categories.forEach((cat, idx) => {
      cat.displayOrder = idx;
      cat.number = idx + 1;
    });
    this.budget.recalculateTotals();
    this.saveBudgetChanges();
  }

  /**
   * Tier 2: Reordering direct lines and top-level groups within a section (revenues or expenses)
   */
  onDropSectionItem(section: CategorySection, event: CdkDragDrop<any[]>): void {
    if (!section?.items) return;
    moveItemInArray(section.items, event.previousIndex, event.currentIndex);
    section.items.forEach((it, idx) => {
      it.displayOrder = idx;
    });
    this.budget?.recalculateTotals();
    this.saveBudgetChanges();
  }

  /**
   * Tier 3: Reordering lines and sub-groups within any group
   */
  onDropGroupItem(group: DynamicBudgetGroup, event: CdkDragDrop<any[]>): void {
    if (!group?.items) return;
    moveItemInArray(group.items, event.previousIndex, event.currentIndex);
    group.items.forEach((it, idx) => {
      it.displayOrder = idx;
    });
    this.budget?.recalculateTotals();
    this.saveBudgetChanges();
  }

  // ==========================================
  // ACTIONS: CATEGORIES MANAGEMENT
  // ==========================================

  async openAddCategoryModal(): Promise<void> {
    if (!this.budget) return;
    const nextNumber = (this.budget.categories?.length || 0) + 1;
    const modal = await this.modalCtrl.create({
      component: BudgetCategoryModalComponent,
      componentProps: {
        isNew: true,
        defaultType: this.selectedTypeFilter,
        nextNumber
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.category && this.budget) {
      this.budget.categories = this.budget.categories || [];
      data.category.displayOrder = this.budget.categories.length;
      data.category.number = this.budget.categories.length + 1;
      this.budget.categories.push(data.category);
      this.budget.recalculateTotals();
      await this.saveBudgetChanges();
    }
  }

  async openEditCategoryModal(category: DynamicBudgetCategory, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.budget) return;
    const modal = await this.modalCtrl.create({
      component: BudgetCategoryModalComponent,
      componentProps: {
        category,
        isNew: false
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.category && this.budget) {
      const idx = this.budget.categories.findIndex((c) => c.id === category.id);
      if (idx !== -1) {
        // preserve existing items
        if (data.category.revenues && category.revenues) {
          data.category.revenues.items = category.revenues.items;
        }
        if (data.category.expenses && category.expenses) {
          data.category.expenses.items = category.expenses.items;
        }
        data.category.number = category.number;
        data.category.displayOrder = category.displayOrder;
        this.budget.categories[idx] = data.category;
        this.budget.recalculateTotals();
        await this.saveBudgetChanges();
      }
    }
  }

  async confirmDeleteCategory(category: DynamicBudgetCategory, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.budget) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.BUDGET.CONFIRM_DELETE_CAT_TITLE'),
      message: this.translate.instant('FINANCES.BUDGET.CONFIRM_DELETE_CAT_MSG', {
        name: `${category.number}. ${(this.app.currentLanguage === 'en' ? category.name?.en : category.name?.pl) || category.name?.pl || category.name?.en || category.id}`
      }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            if (!this.budget) return;
            this.budget.categories = (this.budget.categories || []).filter((c) => c.id !== category.id);
            // Re-number remaining categories
            this.budget.categories.forEach((cat, idx) => {
              cat.displayOrder = idx;
              cat.number = idx + 1;
            });
            this.budget.recalculateTotals();
            await this.saveBudgetChanges();
          }
        }
      ]
    });
    await alert.present();
  }

  // ==========================================
  // ACTIONS: REVENUE / EXPENSE SECTIONS
  // ==========================================

  async addRevenueSection(category: DynamicBudgetCategory, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    category.revenues = {
      enabled: true,
      type: 'REVENUE',
      items: []
    };
    this.budget?.recalculateTotals();
    await this.saveBudgetChanges();
  }

  async addExpenseSection(category: DynamicBudgetCategory, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    category.expenses = {
      enabled: true,
      type: 'EXPENSE',
      items: []
    };
    this.budget?.recalculateTotals();
    await this.saveBudgetChanges();
  }

  async confirmRemoveSection(category: DynamicBudgetCategory, type: 'REVENUE' | 'EXPENSE', event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.BUDGET.REMOVE_SECTION_TITLE'),
      message: this.translate.instant('FINANCES.BUDGET.REMOVE_SECTION_MSG'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            if (type === 'REVENUE') {
              category.revenues = undefined;
            } else {
              category.expenses = undefined;
            }
            this.budget?.recalculateTotals();
            await this.saveBudgetChanges();
          }
        }
      ]
    });
    await alert.present();
  }

  // ==========================================
  // ACTIONS: GROUPS & SUBGROUPS
  // ==========================================

  async openAddGroupModal(
    targetContainer: CategorySection | DynamicBudgetGroup,
    category: DynamicBudgetCategory,
    event?: Event
  ): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.budget) return;

    const modal = await this.modalCtrl.create({
      component: BudgetGroupModalComponent,
      componentProps: {
        categoryName: `${category.number}. ${(this.app.currentLanguage === 'en' ? category.name.en : category.name.pl) || category.name.pl || category.name.en}`,
        isNew: true
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.group && this.budget) {
      delete data.group.code;
      targetContainer.items = targetContainer.items || [];
      data.group.displayOrder = targetContainer.items.length;
      targetContainer.items.push(data.group);
      this.budget.recalculateTotals();
      await this.saveBudgetChanges();
    }
  }

  async openEditGroupModal(
    group: DynamicBudgetGroup,
    category: DynamicBudgetCategory,
    event?: Event
  ): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.budget) return;
    const modal = await this.modalCtrl.create({
      component: BudgetGroupModalComponent,
      componentProps: {
        group,
        categoryName: `${category.number}. ${(this.app.currentLanguage === 'en' ? category.name.en : category.name.pl) || category.name.pl || category.name.en}`,
        isNew: false
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.group && this.budget) {
      delete group.code;
      group.name = data.group.name;
      this.budget.recalculateTotals();
      await this.saveBudgetChanges();
    }
  }

  async confirmDeleteGroup(
    targetContainer: CategorySection | DynamicBudgetGroup,
    group: DynamicBudgetGroup,
    event?: Event
  ): Promise<void> {
    if (event) event.stopPropagation();
    if (!this.budget) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.BUDGET.CONFIRM_DELETE_GRP_TITLE'),
      message: this.translate.instant('FINANCES.BUDGET.CONFIRM_DELETE_GRP_MSG', {
        name: (this.app.currentLanguage === 'en' ? group.name?.en : group.name?.pl) || group.name?.pl || group.name?.en
      }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            if (!this.budget) return;
            targetContainer.items = (targetContainer.items || []).filter((it) => it !== group);
            this.budget.recalculateTotals();
            await this.saveBudgetChanges();
          }
        }
      ]
    });
    await alert.present();
  }

  // ==========================================
  // ACTIONS: BUDGET LINES
  // ==========================================

  async openAddLineModal(
    targetContainer: CategorySection | DynamicBudgetGroup,
    defaultType: BudgetLineType = 'EXPENSE'
  ): Promise<void> {
    const isGrp = isBudgetGroup(targetContainer);
    const prefix = isGrp ? (targetContainer as DynamicBudgetGroup).code || '' : '';

    const modal = await this.modalCtrl.create({
      component: BudgetLineModalComponent,
      componentProps: {
        groupCodePrefix: prefix,
        existingCodes: this.getAllExistingCodes(),
        isNew: true
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.line && this.budget) {
      data.line.type = defaultType;
      targetContainer.items = targetContainer.items || [];
      data.line.displayOrder = targetContainer.items.length;
      targetContainer.items.push(data.line);
      this.budget.recalculateTotals();
      await this.saveBudgetChanges();
    }
  }

  async openEditLineModal(
    targetContainer: CategorySection | DynamicBudgetGroup,
    lineItem: BudgetLineItem
  ): Promise<void> {
    const isGrp = isBudgetGroup(targetContainer);
    const prefix = isGrp ? (targetContainer as DynamicBudgetGroup).code || '' : '';

    const modal = await this.modalCtrl.create({
      component: BudgetLineModalComponent,
      componentProps: {
        lineItem,
        groupCodePrefix: prefix,
        existingCodes: this.getAllExistingCodes(),
        isNew: false
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.line && this.budget) {
      const idx = (targetContainer.items || []).findIndex((it) => isBudgetLine(it) && it.code === lineItem.code);
      if (idx !== -1) {
        data.line.type = lineItem.type;
        targetContainer.items[idx] = data.line;
        this.budget.recalculateTotals();
        await this.saveBudgetChanges();
      }
    }
  }

  async confirmDeleteLine(
    targetContainer: CategorySection | DynamicBudgetGroup,
    lineItem: BudgetLineItem
  ): Promise<void> {
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.BUDGET.CONFIRM_DELETE_TITLE'),
      message: this.translate.instant('FINANCES.BUDGET.CONFIRM_DELETE_MSG', { code: lineItem.code }),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('COMMON.DELETE'),
          role: 'destructive',
          handler: async () => {
            if (!this.budget) return;
            targetContainer.items = (targetContainer.items || []).filter((it) => !isBudgetLine(it) || it.code !== lineItem.code);
            this.budget.recalculateTotals();
            await this.saveBudgetChanges();
          }
        }
      ]
    });
    await alert.present();
  }

  // ==========================================
  // ACTIONS: EXPORT & AMENDMENT
  // ==========================================

  async openExportModal(): Promise<void> {
    if (!this.budget) return;
    const modal = await this.modalCtrl.create({
      component: BudgetExportModalComponent,
      componentProps: {
        budget: this.budget,
        year: this.stateService.activeYear,
        currentBalances: this.currentBalances
      }
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.exported) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.MODALS.BUDGET_EXPORT.EXPORT_SUCCESS'),
        duration: 3000,
        color: 'success'
      });
      await toast.present();
    }
  }

  async openAmendmentModal(): Promise<void> {
    if (!this.budget) return;
    const modal = await this.modalCtrl.create({
      component: AmendmentModalComponent,
      componentProps: {
        budget: this.budget,
        year: this.stateService.activeYear
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.saved && data?.budget) {
      this.budget = data.budget;
    }
  }

  // ==========================================
  // JUMP TO LINKED TRANSACTIONS / DOCUMENTS
  // ==========================================

  jumpToDocuments(lineCode: string): void {
    this.navService.jumpTo({
      subtab: 'DOCUMENTS',
      code: lineCode,
      year: this.stateService.activeYear
    });
  }

  jumpToTransactions(lineCode: string): void {
    this.navService.jumpTo({
      subtab: 'TRANSACTIONS',
      code: lineCode,
      year: this.stateService.activeYear
    });
  }

  // ==========================================
  // OPENING BALANCES MANAGEMENT
  // ==========================================

  async fetchNbpEurRateForYear(year: number): Promise<{ rate: number; date: string } | null> {
    let dateObj = new Date(year - 1, 11, 31, 12, 0, 0);
    while (dateObj.getDay() === 0 || dateObj.getDay() === 6) {
      dateObj.setDate(dateObj.getDate() - 1);
    }

    let attempts = 0;
    while (attempts < 10) {
      const y = dateObj.getFullYear();
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const d = String(dateObj.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;

      try {
        const response = await fetch(`https://api.nbp.pl/api/exchangerates/rates/A/EUR/${dateStr}?format=JSON`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.rates && data.rates[0]) {
            return {
              rate: data.rates[0].mid,
              date: dateStr
            };
          }
        }
      } catch (err) {
        // ignore
      }
      dateObj.setDate(dateObj.getDate() - 1);
      while (dateObj.getDay() === 0 || dateObj.getDay() === 6) {
        dateObj.setDate(dateObj.getDate() - 1);
      }
      attempts++;
    }
    return null;
  }

  async startEditingOpeningBalances(): Promise<void> {
    this.isEditingOpeningBalances = true;
    if (this.budget) {
      this.isLoadingNbpRate = true;
      try {
        const nbp = await this.fetchNbpEurRateForYear(this.budget.year);
        if (nbp) {
          this.editingOpeningBalances.eurExchangeRate = nbp.rate;
          this.editingOpeningBalances.eurExchangeDate = nbp.date;
          this.onEurAmountChange();
        }
      } finally {
        this.isLoadingNbpRate = false;
      }
    }
  }

  onEurAmountChange(): void {
    const bEur = parseLocaleNumber(this.editingOpeningBalances.bankEur) || 0;
    const rate = this.editingOpeningBalances.eurExchangeRate || 0;
    if (rate > 0) {
      this.editingOpeningBalances.bankEurInPln = Math.round(bEur * rate * 100) / 100;
    }
  }

  cancelEditingOpeningBalances(): void {
    this.isEditingOpeningBalances = false;
    this.initOpeningBalancesState();
  }

  async saveOpeningBalances(): Promise<void> {
    if (!this.budget) return;
    const bPln = parseLocaleNumber(this.editingOpeningBalances.bankPln) || 0;
    const bEur = parseLocaleNumber(this.editingOpeningBalances.bankEur) || 0;
    const rate = this.editingOpeningBalances.eurExchangeRate || 0;
    const date = this.editingOpeningBalances.eurExchangeDate || '';
    const bEurInPln = rate > 0 ? Math.round(bEur * rate * 100) / 100 : (parseLocaleNumber(this.editingOpeningBalances.bankEurInPln) || 0);
    const dep = parseLocaleNumber(this.editingOpeningBalances.termDepositsPln) || 0;

    this.budget.openingBalances = {
      ...this.budget.openingBalances,
      bankPln: bPln,
      bankPlnStartingBalance: bPln,
      bankEurStartingBalance: bEur,
      bankEurInPln: bEurInPln,
      eurExchangeRate: rate,
      eurExchangeDate: date,
      termDepositsPln: dep,
      termDepositsStartingBalance: dep,
      totalOpeningBalance: bPln + bEurInPln + dep
    };
    this.budget.recalculateTotals();
    await this.saveBudgetChanges();
    this.recomputeCurrentBalances();
    this.isEditingOpeningBalances = false;
  }

  private async saveBudgetChanges(): Promise<void> {
    if (!this.budget) return;
    const loading = await this.loadingCtrl.create({ message: this.translate.instant('FINANCES.BUDGET.SAVING') });
    await loading.present();
    try {
      this.budget = await this.financesService.saveBudget(this.budget);
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.SAVE_SUCCESS'),
        duration: 2500,
        color: 'success'
      });
      await toast.present();
    } catch (err: any) {
      const toast = await this.toastCtrl.create({
        message: err?.message || this.translate.instant('FINANCES.BUDGET.SAVE_ERROR'),
        duration: 4000,
        color: 'danger'
      });
      await toast.present();
    } finally {
      await loading.dismiss();
    }
  }
}
