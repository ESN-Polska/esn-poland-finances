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
  BudgetVersionSnapshot,
  BudgetAmendment,
  BudgetAmendmentDraft,
  BudgetAmendmentItem,
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
import { BudgetHistoryModalComponent } from '../../modals/budget-history-modal/budget-history-modal.component';
import { parseLocaleNumber } from '../../../../utils/number-utils';
import {
  CurrentBankBalances,
  computeCurrentBankBalances,
  fetchNbpEurRateBeforeToday,
  generateAmendmentDraftCsvContent,
  generateAmendmentDraftHtmlReport,
  downloadCsvFile,
  openPrintablePdf,
  AmendmentDraftExportOptions
} from './budget-export.util';

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

  // ==========================================
  // AMENDMENT DRAFT & VERSION HISTORY STATE
  // ==========================================
  isAmending: boolean = false;
  activeSnapshotView: BudgetVersionSnapshot | null = null;
  amendmentWorkingCategories: DynamicBudgetCategory[] = [];
  amendmentItemsDiff: BudgetAmendmentItem[] = [];
  amendmentJustifications: Record<string, string> = {};
  amendmentOriginalLinesMap = new Map<string, {
    lineId?: string;
    code: string;
    plannedAmount: number;
    name: { pl: string; en: string };
    type: BudgetLineType;
    categoryPath: string;
    actualAmountAtTime: number;
  }>();

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
    if (this.isAmending && this.budget) {
      this.saveDraftAmendment(true);
    }
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
      this.isAmending = false;
      this.activeSnapshotView = null;
      this.amendmentWorkingCategories = [];
      this.amendmentItemsDiff = [];
      this.amendmentJustifications = {};
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
            const res = data.resolutionNumber.trim();
            const date = data.adoptedDate || new Date().toISOString().substring(0, 10);
            this.budget.adopt(res, date, this.app.currentUser?.userId);
            await this.saveBudgetChanges();
            return true;
          }
        }
      ]
    });
    await alert.present();
  }

  get currentResolutionNumber(): string {
    if (this.activeSnapshotView) {
      return this.activeSnapshotView.resolutionNumber;
    }
    if (this.budget?.amendments && this.budget.amendments.length > 0) {
      const latest = this.budget.amendments[this.budget.amendments.length - 1];
      if (latest?.resolutionNumber) {
        return latest.resolutionNumber;
      }
    }
    return this.budget?.resolutionNumber || '';
  }

  get currentAdoptedDate(): string {
    if (this.activeSnapshotView) {
      return this.activeSnapshotView.adoptedDate || '';
    }
    if (this.budget?.amendments && this.budget.amendments.length > 0) {
      const latest = this.budget.amendments[this.budget.amendments.length - 1];
      if (latest?.adoptedDate || latest?.date) {
        return latest.adoptedDate || latest.date || '';
      }
    }
    return this.budget?.adoptedDate || '';
  }

  enterSnapshotView(snap: BudgetVersionSnapshot): void {
    this.activeSnapshotView = snap;
  }

  private async initOpeningBalancesState(): Promise<void> {
    if (this.budget?.openingBalances) {
      let bEur = this.budget.openingBalances.bankEurStartingBalance || this.budget.openingBalances.bankEur || 0;
      let rate = this.budget.openingBalances.eurExchangeRate || 0;
      let date = this.budget.openingBalances.eurExchangeDate || '';

      if (this.budget.year) {
        const nbp = await this.fetchNbpEurRateForYear(this.budget.year);
        if (nbp) {
          rate = nbp.rate;
          date = nbp.date;
        }
      }

      // If EUR starting balance was not explicitly set, but bankEurInPln exists,
      // it means the user entered the opening balance in EUR, but it was stored under bankEurInPln:
      if (!bEur && this.budget.openingBalances.bankEurInPln) {
        bEur = this.budget.openingBalances.bankEurInPln;
        this.budget.openingBalances.bankEurStartingBalance = bEur;
        this.budget.openingBalances.bankEur = bEur;
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

  get isOpeningBalancesLocked(): boolean {
    if (this.budget?.openingBalances?.isLocked !== undefined) {
      return Boolean(this.budget.openingBalances.isLocked);
    }
    return Boolean(
      this.budget?.openingBalances?.totalOpeningBalance &&
      this.budget.openingBalances.totalOpeningBalance > 0
    );
  }

  get canModifyConfigurations(): boolean {
    const user = this.app.currentUser;
    if (!user) return false;
    return (
      user.isAdministrator ||
      user.hasPermission(AppPermission.CONFIGURATIONS.FINANCES) ||
      user.hasPermission(AppPermission.CONFIGURATIONS.OPTIONS)
    );
  }

  goToConfigurationsFinances(): void {
    this.app.goTo(['/t/configurations'], { queryParams: { section: 'FINANCES' } });
  }

  get isArchived(): boolean {
    return this.stateService.isArchived;
  }

  get isDraft(): boolean {
    return this.budget?.status === 'DRAFT';
  }

  get isAdopted(): boolean {
    return this.budget?.status === 'ADOPTED' || this.budget?.status === 'AMENDED';
  }

  get hasDraftAmendment(): boolean {
    return !!this.budget?.draftAmendment && (
      (this.budget.draftAmendment.itemsDiff && this.budget.draftAmendment.itemsDiff.length > 0) ||
      (this.budget.draftAmendment.draftCategories && this.budget.draftAmendment.draftCategories.length > 0)
    );
  }

  get canModifyStructure(): boolean {
    return this.canEdit && !this.isArchived && !this.activeSnapshotView && (this.isDraft || this.isAmending);
  }

  get displayCategories(): DynamicBudgetCategory[] {
    if (this.activeSnapshotView) {
      return this.activeSnapshotView.categories || [];
    }
    if (this.isAmending) {
      return this.amendmentWorkingCategories;
    }
    return this.budget?.categories || [];
  }

  get amendmentRevenueDelta(): number {
    return this.amendmentItemsDiff
      .filter((i) => i.type === 'REVENUE')
      .reduce((sum, i) => sum + (i.deltaAmount || i.difference || 0), 0);
  }

  get amendmentExpenseDelta(): number {
    return this.amendmentItemsDiff
      .filter((i) => i.type === 'EXPENSE')
      .reduce((sum, i) => sum + (i.deltaAmount || i.difference || 0), 0);
  }

  get amendmentNetDelta(): number {
    return this.amendmentRevenueDelta - this.amendmentExpenseDelta;
  }

  // ==========================================
  // METRICS COMPUTATIONS
  // ==========================================

  get totalPlannedRevenue(): number {
    if (this.activeSnapshotView) {
      return this.activeSnapshotView.totalRevenue || 0;
    }
    if (this.isAmending) {
      return (this.budget?.totalPlannedRevenue || 0) + this.amendmentRevenueDelta;
    }
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
    if (this.activeSnapshotView) {
      return this.activeSnapshotView.totalExpense || 0;
    }
    if (this.isAmending) {
      return (this.budget?.totalPlannedExpenses || 0) + this.amendmentExpenseDelta;
    }
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
    if (this.activeSnapshotView) {
      return this.activeSnapshotView.netResult || 0;
    }
    if (this.isAmending) {
      return this.totalPlannedRevenue - this.totalPlannedExpenses;
    }
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
    const list = this.displayCategories;
    if (!list || list.length === 0) return [];
    let res = list;

    if (this.selectedTypeFilter === 'REVENUE') {
      res = res.filter((c) => c.revenues && c.revenues.enabled !== false && ((c.revenues.items && c.revenues.items.length > 0) || (c.totalPlannedRevenue || 0) > 0));
    } else if (this.selectedTypeFilter === 'EXPENSE') {
      res = res.filter((c) => c.expenses && c.expenses.enabled !== false && ((c.expenses.items && c.expenses.items.length > 0) || (c.totalPlannedExpense || 0) > 0));
    }

    if (!this.searchQuery.trim()) {
      return res;
    }

    const q = this.searchQuery.toLowerCase().trim();
    return res.filter((cat) => {
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

  isCodeTruncated(code?: string): boolean {
    return !!code && code.trim().length >= 10;
  }

  getAllExistingCodes(type?: BudgetLineType): string[] {
    const codes: string[] = [];
    const collect = (items: (DynamicBudgetGroup | BudgetLineItem)[]) => {
      for (const it of items || []) {
        if (isBudgetLine(it)) {
          if (it.code) codes.push(it.code);
        } else if (isBudgetGroup(it)) {
          collect(it.items || []);
        }
      }
    };
    for (const cat of this.displayCategories) {
      if ((!type || type === 'REVENUE') && cat.revenues?.items) collect(cat.revenues.items);
      if ((!type || type === 'EXPENSE') && cat.expenses?.items) collect(cat.expenses.items);
    }
    return codes;
  }

  getAllExistingGroupCodes(): string[] {
    const codes: string[] = [];
    const collect = (items: (DynamicBudgetGroup | BudgetLineItem)[]) => {
      for (const it of items || []) {
        if (isBudgetGroup(it)) {
          if (it.code) codes.push(it.code);
          collect(it.items || []);
        }
      }
    };
    for (const cat of this.displayCategories) {
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
    const targetList = this.isAmending ? this.amendmentWorkingCategories : this.budget?.categories;
    if (!targetList) return;
    moveItemInArray(targetList, event.previousIndex, event.currentIndex);
    targetList.forEach((cat, idx) => {
      cat.displayOrder = idx;
      cat.number = idx + 1;
    });
    if (this.isAmending) {
      this.recalculateWorkingTotals();
      this.recomputeAmendmentDiff();
      this.saveDraftAmendment(true);
    } else {
      this.budget?.recalculateTotals();
      this.saveBudgetChanges();
    }
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
    if (this.isAmending) {
      this.recalculateWorkingTotals();
      this.recomputeAmendmentDiff();
      this.saveDraftAmendment(true);
    } else {
      this.budget?.recalculateTotals();
      this.saveBudgetChanges();
    }
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
    if (this.isAmending) {
      this.recalculateWorkingTotals();
      this.recomputeAmendmentDiff();
      this.saveDraftAmendment(true);
    } else {
      this.budget?.recalculateTotals();
      this.saveBudgetChanges();
    }
  }

  // ==========================================
  // ACTIONS: CATEGORIES MANAGEMENT
  // ==========================================

  async openAddCategoryModal(): Promise<void> {
    const list = this.isAmending ? this.amendmentWorkingCategories : (this.budget?.categories || []);
    const nextNumber = list.length + 1;
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
    if (data?.category) {
      data.category.displayOrder = list.length;
      data.category.number = list.length + 1;
      list.push(data.category);
      if (this.isAmending) {
        this.recalculateWorkingTotals();
        this.recomputeAmendmentDiff();
        await this.saveDraftAmendment(true);
      } else if (this.budget) {
        this.budget.categories = list;
        this.budget.recalculateTotals();
        await this.saveBudgetChanges();
      }
    }
  }

  async openEditCategoryModal(category: DynamicBudgetCategory, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    const list = this.isAmending ? this.amendmentWorkingCategories : this.budget?.categories;
    if (!list) return;
    const modal = await this.modalCtrl.create({
      component: BudgetCategoryModalComponent,
      componentProps: {
        category,
        isNew: false
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.category) {
      const idx = list.findIndex((c) => c.id === category.id);
      if (idx !== -1) {
        if (data.category.revenues && category.revenues) {
          data.category.revenues.items = category.revenues.items;
        }
        if (data.category.expenses && category.expenses) {
          data.category.expenses.items = category.expenses.items;
        }
        data.category.number = category.number;
        data.category.displayOrder = category.displayOrder;
        list[idx] = data.category;
        if (this.isAmending) {
          this.recalculateWorkingTotals();
          this.recomputeAmendmentDiff();
          await this.saveDraftAmendment(true);
        } else if (this.budget) {
          this.budget.recalculateTotals();
          await this.saveBudgetChanges();
        }
      }
    }
  }

  async confirmDeleteCategory(category: DynamicBudgetCategory, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
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
            if (this.isAmending) {
              this.amendmentWorkingCategories = this.amendmentWorkingCategories.filter((c) => c.id !== category.id);
              this.amendmentWorkingCategories.forEach((cat, idx) => {
                cat.displayOrder = idx;
                cat.number = idx + 1;
              });
              this.recalculateWorkingTotals();
              this.recomputeAmendmentDiff();
              await this.saveDraftAmendment(true);
            } else if (this.budget) {
              this.budget.categories = (this.budget.categories || []).filter((c) => c.id !== category.id);
              this.budget.categories.forEach((cat, idx) => {
                cat.displayOrder = idx;
                cat.number = idx + 1;
              });
              this.budget.recalculateTotals();
              await this.saveBudgetChanges();
            }
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
    if (this.isAmending) {
      this.recalculateWorkingTotals();
      this.recomputeAmendmentDiff();
      await this.saveDraftAmendment(true);
    } else {
      this.budget?.recalculateTotals();
      await this.saveBudgetChanges();
    }
  }

  async addExpenseSection(category: DynamicBudgetCategory, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    category.expenses = {
      enabled: true,
      type: 'EXPENSE',
      items: []
    };
    if (this.isAmending) {
      this.recalculateWorkingTotals();
      this.recomputeAmendmentDiff();
      await this.saveDraftAmendment(true);
    } else {
      this.budget?.recalculateTotals();
      await this.saveBudgetChanges();
    }
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
            if (this.isAmending) {
              this.recalculateWorkingTotals();
              this.recomputeAmendmentDiff();
              await this.saveDraftAmendment(true);
            } else {
              this.budget?.recalculateTotals();
              await this.saveBudgetChanges();
            }
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
    const modal = await this.modalCtrl.create({
      component: BudgetGroupModalComponent,
      componentProps: {
        categoryName: `${category.number}. ${(this.app.currentLanguage === 'en' ? category.name.en : category.name.pl) || category.name.pl || category.name.en}`,
        isNew: true
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.group) {
      delete data.group.code;
      targetContainer.items = targetContainer.items || [];
      data.group.displayOrder = targetContainer.items.length;
      targetContainer.items.push(data.group);
      if (this.isAmending) {
        this.recalculateWorkingTotals();
        this.recomputeAmendmentDiff();
        await this.saveDraftAmendment(true);
      } else {
        this.budget?.recalculateTotals();
        await this.saveBudgetChanges();
      }
    }
  }

  async openEditGroupModal(
    group: DynamicBudgetGroup,
    category: DynamicBudgetCategory,
    event?: Event
  ): Promise<void> {
    if (event) event.stopPropagation();
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
    if (data?.group) {
      delete group.code;
      group.name = data.group.name;
      if (this.isAmending) {
        this.recalculateWorkingTotals();
        this.recomputeAmendmentDiff();
        await this.saveDraftAmendment(true);
      } else {
        this.budget?.recalculateTotals();
        await this.saveBudgetChanges();
      }
    }
  }

  async confirmDeleteGroup(
    targetContainer: CategorySection | DynamicBudgetGroup,
    group: DynamicBudgetGroup,
    event?: Event
  ): Promise<void> {
    if (event) event.stopPropagation();
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
            targetContainer.items = (targetContainer.items || []).filter((it) => it !== group);
            if (this.isAmending) {
              this.recalculateWorkingTotals();
              this.recomputeAmendmentDiff();
              await this.saveDraftAmendment(true);
            } else {
              this.budget?.recalculateTotals();
              await this.saveBudgetChanges();
            }
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
        existingCodes: this.getAllExistingCodes(defaultType),
        lineType: defaultType,
        isNew: true,
        isAmending: this.isAmending,
        currentApprovedAmount: 0,
        initialJustification: ''
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.line) {
      data.line.type = defaultType;
      targetContainer.items = targetContainer.items || [];
      data.line.displayOrder = targetContainer.items.length;
      targetContainer.items.push(data.line);

      if (this.isAmending) {
        if (data.justification) {
          this.amendmentJustifications[data.line.code] = data.justification;
        }
        this.recalculateWorkingTotals();
        this.recomputeAmendmentDiff();
        await this.saveDraftAmendment(true);
      } else if (this.budget) {
        this.budget.recalculateTotals();
        await this.saveBudgetChanges();
      }
    }
  }

  async openEditLineModal(
    targetContainer: CategorySection | DynamicBudgetGroup,
    lineItem: BudgetLineItem
  ): Promise<void> {
    const isGrp = isBudgetGroup(targetContainer);
    const prefix = isGrp ? (targetContainer as DynamicBudgetGroup).code || '' : '';
    const lineType = lineItem.type || 'EXPENSE';
    const orig = this.amendmentOriginalLinesMap.get(`${lineType}:${lineItem.code}`);
    const currentApproved = orig ? orig.plannedAmount : (lineItem.plannedAmount || 0);
    const existingJustification =
      this.amendmentJustifications[`${lineType}:${lineItem.code}`] ||
      this.amendmentJustifications[lineItem.code] ||
      '';

    const modal = await this.modalCtrl.create({
      component: BudgetLineModalComponent,
      componentProps: {
        lineItem,
        groupCodePrefix: prefix,
        existingCodes: this.getAllExistingCodes(lineType).filter((c) => c !== lineItem.code),
        lineType,
        isNew: false,
        isAmending: this.isAmending,
        currentApprovedAmount: currentApproved,
        initialJustification: existingJustification
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.line) {
      const idx = (targetContainer.items || []).findIndex((it) => isBudgetLine(it) && it.code === lineItem.code);
      if (idx !== -1) {
        data.line.type = lineItem.type;
        targetContainer.items[idx] = data.line;

        if (this.isAmending) {
          if (data.justification !== undefined) {
            this.amendmentJustifications[data.line.code] = data.justification;
          }
          this.recalculateWorkingTotals();
          this.recomputeAmendmentDiff();
          await this.saveDraftAmendment(true);
        } else if (this.budget) {
          this.budget.recalculateTotals();
          await this.saveBudgetChanges();
        }
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
            targetContainer.items = (targetContainer.items || []).filter((it) => !isBudgetLine(it) || it.code !== lineItem.code);
            if (this.isAmending) {
              this.recalculateWorkingTotals();
              this.recomputeAmendmentDiff();
              await this.saveDraftAmendment(true);
            } else if (this.budget) {
              this.budget.recalculateTotals();
              await this.saveBudgetChanges();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  // ==========================================
  // AMENDMENT LIFECYCLE METHODS
  // ==========================================

  getLineDiff(code: string, type?: BudgetLineType): BudgetAmendmentItem | undefined {
    if (!this.isAmending) return undefined;
    return this.amendmentItemsDiff.find((d) => {
      const matchesCode = d.budgetCode === code || d.lineCode === code;
      if (!matchesCode) return false;
      if (type && d.type && d.type !== type) return false;
      return true;
    });
  }

  recalculateWorkingTotals(): void {
    const tempBudget = new AnnualBudget({ categories: this.amendmentWorkingCategories });
    tempBudget.recalculateTotals();
    this.amendmentWorkingCategories = tempBudget.categories;
  }

  private buildLinesMap(categories: DynamicBudgetCategory[]): Map<string, {
    lineId?: string;
    code: string;
    plannedAmount: number;
    name: { pl: string; en: string };
    type: BudgetLineType;
    categoryPath: string;
    actualAmountAtTime: number;
  }> {
    const map = new Map();
    for (const cat of categories || []) {
      const catName = (this.app.currentLanguage === 'en' ? cat.name?.en : cat.name?.pl) || cat.name?.pl || cat.name?.en || `Kategoria ${cat.number}`;
      if (cat.revenues?.items) {
        this.collectLinesIntoMap(cat.revenues.items, `${catName} > Przychody`, 'REVENUE', map);
      }
      if (cat.expenses?.items) {
        this.collectLinesIntoMap(cat.expenses.items, `${catName} > Koszty`, 'EXPENSE', map);
      }
    }
    return map;
  }

  private collectLinesIntoMap(
    items: (DynamicBudgetGroup | BudgetLineItem)[],
    currentPath: string,
    defaultType: BudgetLineType,
    map: Map<string, any>
  ): void {
    for (const item of items || []) {
      if (isBudgetGroup(item)) {
        const grpName = (this.app.currentLanguage === 'en' ? item.name?.en : item.name?.pl) || item.name?.pl || item.name?.en || item.id;
        this.collectLinesIntoMap(item.items || [], `${currentPath} > ${grpName}`, defaultType, map);
      } else if (isBudgetLine(item)) {
        const lineType = item.type || defaultType;
        map.set(`${lineType}:${item.code}`, {
          lineId: item.id || item.code,
          code: item.code,
          plannedAmount: Number(item.plannedAmount ?? item.budgetedAmount) || 0,
          name: { pl: item.name?.pl || '', en: item.name?.en || '' },
          type: lineType,
          categoryPath: currentPath,
          actualAmountAtTime: Number(item.actualAmount) || 0
        });
      }
    }
  }

  private extractAllLinesWithPaths(categories: DynamicBudgetCategory[]): { line: BudgetLineItem; categoryPath: string }[] {
    const list: { line: BudgetLineItem; categoryPath: string }[] = [];
    for (const cat of categories || []) {
      const catName = (this.app.currentLanguage === 'en' ? cat.name?.en : cat.name?.pl) || cat.name?.pl || cat.name?.en || `Kategoria ${cat.number}`;
      if (cat.revenues?.items) {
        this.collectLinesWithPaths(cat.revenues.items, `${catName} > Przychody`, 'REVENUE', list);
      }
      if (cat.expenses?.items) {
        this.collectLinesWithPaths(cat.expenses.items, `${catName} > Koszty`, 'EXPENSE', list);
      }
    }
    return list;
  }

  private collectLinesWithPaths(
    items: (DynamicBudgetGroup | BudgetLineItem)[],
    currentPath: string,
    defaultType: BudgetLineType,
    list: { line: BudgetLineItem; categoryPath: string }[]
  ): void {
    for (const item of items || []) {
      if (isBudgetGroup(item)) {
        const grpName = (this.app.currentLanguage === 'en' ? item.name?.en : item.name?.pl) || item.name?.pl || item.name?.en || item.id;
        this.collectLinesWithPaths(item.items || [], `${currentPath} > ${grpName}`, defaultType, list);
      } else if (isBudgetLine(item)) {
        list.push({ line: item, categoryPath: currentPath });
      }
    }
  }

  recomputeAmendmentDiff(): void {
    const workingLines = this.extractAllLinesWithPaths(this.amendmentWorkingCategories);
    const diffItems: BudgetAmendmentItem[] = [];
    const seenKeys = new Set<string>();

    for (const w of workingLines) {
      const lineType = w.line.type || 'EXPENSE';
      const key = `${lineType}:${w.line.code}`;
      seenKeys.add(key);
      const orig = this.amendmentOriginalLinesMap.get(key);
      const justification = this.amendmentJustifications[key] || this.amendmentJustifications[w.line.code] || '';

      if (!orig) {
        // Newly added line
        const proposed = Number(w.line.plannedAmount) || 0;
        diffItems.push({
          lineId: w.line.id || w.line.code,
          budgetCode: w.line.code,
          lineCode: w.line.code,
          lineName: { pl: w.line.name?.pl || '', en: w.line.name?.en || '' },
          newLineName: { pl: w.line.name?.pl || '', en: w.line.name?.en || '' },
          type: lineType,
          changeType: 'ADD_LINE',
          currentAmount: 0,
          previousAmount: 0,
          proposedAmount: proposed,
          newAmount: proposed,
          deltaAmount: proposed,
          difference: proposed,
          actualAmountAtTime: 0,
          explanation: justification,
          justification,
          categoryPath: w.categoryPath
        });
      } else {
        const proposed = Number(w.line.plannedAmount) || 0;
        const current = Number(orig.plannedAmount) || 0;
        const delta = Math.round((proposed - current) * 100) / 100;
        const nameChanged = (w.line.name?.pl || '') !== orig.name.pl || (w.line.name?.en || '') !== orig.name.en;
        const amountChanged = Math.abs(delta) > 0.001;

        if (amountChanged || nameChanged) {
          diffItems.push({
            lineId: orig.lineId || w.line.code,
            budgetCode: w.line.code,
            lineCode: w.line.code,
            lineName: { pl: w.line.name?.pl || '', en: w.line.name?.en || '' },
            oldLineName: { pl: orig.name.pl, en: orig.name.en },
            newLineName: { pl: w.line.name?.pl || '', en: w.line.name?.en || '' },
            type: orig.type,
            changeType: amountChanged ? 'MODIFY_LINE' : 'RENAME_LINE',
            currentAmount: current,
            previousAmount: current,
            proposedAmount: proposed,
            newAmount: proposed,
            deltaAmount: delta,
            difference: delta,
            actualAmountAtTime: orig.actualAmountAtTime,
            explanation: justification,
            justification,
            categoryPath: w.categoryPath
          });
        }
      }
    }

    // Lines removed in draft
    for (const [key, orig] of this.amendmentOriginalLinesMap.entries()) {
      if (!seenKeys.has(key)) {
        const current = Number(orig.plannedAmount) || 0;
        const justification = this.amendmentJustifications[key] || this.amendmentJustifications[orig.code] || '';
        diffItems.push({
          lineId: orig.lineId || orig.code,
          budgetCode: orig.code,
          lineCode: orig.code,
          lineName: { pl: orig.name.pl, en: orig.name.en },
          oldLineName: { pl: orig.name.pl, en: orig.name.en },
          type: orig.type,
          changeType: 'REMOVE_LINE',
          currentAmount: current,
          previousAmount: current,
          proposedAmount: 0,
          newAmount: 0,
          deltaAmount: -current,
          difference: -current,
          actualAmountAtTime: orig.actualAmountAtTime,
          explanation: justification,
          justification,
          categoryPath: orig.categoryPath
        });
      }
    }

    this.amendmentItemsDiff = diffItems;
  }

  async startOrContinueAmendment(): Promise<void> {
    if (!this.budget) return;

    this.amendmentOriginalLinesMap = this.buildLinesMap(this.budget.categories || []);

    if (this.budget.draftAmendment && this.budget.draftAmendment.draftCategories?.length) {
      this.amendmentWorkingCategories = JSON.parse(JSON.stringify(this.budget.draftAmendment.draftCategories));
      this.amendmentJustifications = {};
      for (const it of this.budget.draftAmendment.itemsDiff || []) {
        const c = it.budgetCode || it.lineCode;
        if (c && (it.explanation || it.justification)) {
          const key = it.type ? `${it.type}:${c}` : c;
          this.amendmentJustifications[key] = it.explanation || it.justification || '';
          this.amendmentJustifications[c] = it.explanation || it.justification || '';
        }
      }
    } else {
      this.amendmentWorkingCategories = JSON.parse(JSON.stringify(this.budget.categories || []));
      this.amendmentJustifications = {};
    }

    this.recalculateWorkingTotals();
    this.recomputeAmendmentDiff();
    this.isAmending = true;
  }

  async saveDraftAmendment(silent: boolean = false): Promise<void> {
    if (!this.budget) return;
    this.recalculateWorkingTotals();
    this.recomputeAmendmentDiff();

    const draft: BudgetAmendmentDraft = {
      id: this.budget.draftAmendment?.id || `draft_amend_${Date.now()}`,
      updatedAt: new Date().toISOString(),
      draftCategories: this.amendmentWorkingCategories,
      itemsDiff: this.amendmentItemsDiff,
      totalRevenueDelta: this.amendmentRevenueDelta,
      totalExpenseDelta: this.amendmentExpenseDelta,
      netBudgetDelta: this.amendmentNetDelta
    };

    try {
      this.budget.draftAmendment = draft;
      const updated = await this.financesService.saveAmendmentDraft(this.budget.year, draft, this.budget);
      this.budget = updated;
      this.budget.draftAmendment = updated.draftAmendment || draft;
      if (!silent) {
        const toast = await this.toastCtrl.create({
          message: this.translate.instant('FINANCES.BUDGET.DRAFT_SAVED_CAN_RESUME'),
          duration: 2500,
          color: 'success'
        });
        await toast.present();
      }
    } catch (err: any) {
      console.error('Failed to save amendment draft:', err);
      if (!silent) {
        const toast = await this.toastCtrl.create({
          message: err?.message || this.translate.instant('COMMON.SAVE_ERROR'),
          duration: 3500,
          color: 'danger'
        });
        await toast.present();
      }
    }
  }

  async exitAmendmentMode(): Promise<void> {
    await this.saveDraftAmendment(true);
    this.isAmending = false;
    const toast = await this.toastCtrl.create({
      message: this.translate.instant('FINANCES.BUDGET.DRAFT_SAVED_CAN_RESUME'),
      duration: 3000,
      color: 'primary'
    });
    await toast.present();
  }

  async discardAmendmentDraft(): Promise<void> {
    if (!this.budget) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.BUDGET.CONFIRM_DISCARD_AMENDMENT_TITLE'),
      message: this.translate.instant('FINANCES.BUDGET.CONFIRM_DISCARD_AMENDMENT_MSG'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('FINANCES.BUDGET.DISCARD_AMENDMENT_DRAFT_BTN'),
          role: 'destructive',
          handler: async () => {
            if (!this.budget) return;
            try {
              const updated = await this.financesService.discardAmendmentDraft(this.budget.year, this.budget);
              this.budget = updated;
              this.budget.draftAmendment = null;
              this.isAmending = false;
              this.amendmentWorkingCategories = [];
              this.amendmentItemsDiff = [];
              this.amendmentJustifications = {};
              const toast = await this.toastCtrl.create({
                message: this.translate.instant('FINANCES.BUDGET.DISCARD_AMENDMENT_SUCCESS'),
                duration: 2500,
                color: 'success'
              });
              await toast.present();
            } catch (err: any) {
              console.error('Failed to discard amendment draft:', err);
              const toast = await this.toastCtrl.create({
                message: err?.message || this.translate.instant('COMMON.SAVE_ERROR'),
                duration: 3500,
                color: 'danger'
              });
              await toast.present();
            }
          }
        }
      ]
    });
    await alert.present();
  }

  async openAdoptAmendmentModal(): Promise<void> {
    if (!this.budget) return;
    if (this.amendmentItemsDiff.length === 0) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.NO_CHANGES_TO_ADOPT'),
        duration: 3000,
        color: 'warning'
      });
      await toast.present();
      return;
    }

    const modal = await this.modalCtrl.create({
      component: AmendmentModalComponent,
      componentProps: {
        budget: this.budget,
        year: this.budget.year,
        itemsDiff: this.amendmentItemsDiff,
        draftCategories: this.amendmentWorkingCategories
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.saved && data?.budget) {
      this.budget = data.budget;
      this.isAmending = false;
      this.amendmentWorkingCategories = [];
      this.amendmentItemsDiff = [];
      this.amendmentJustifications = {};
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.AMENDMENT_ADOPTED_SUCCESS'),
        duration: 3000,
        color: 'success'
      });
      await toast.present();
    }
  }

  async openExportAmendmentDraftModal(): Promise<void> {
    if (!this.budget) return;
    const alert = await this.alertCtrl.create({
      header: this.translate.instant('FINANCES.BUDGET.EXPORT_AMENDMENT_DRAFT_TITLE'),
      message: this.translate.instant('FINANCES.BUDGET.EXPORT_AMENDMENT_DRAFT_DESC'),
      buttons: [
        { text: this.translate.instant('COMMON.CANCEL'), role: 'cancel' },
        {
          text: this.translate.instant('FINANCES.BUDGET.EXPORT_PDF_BTN'),
          handler: () => {
            this.exportAmendmentDraft('PDF');
          }
        },
        {
          text: this.translate.instant('FINANCES.BUDGET.EXPORT_CSV_BTN'),
          handler: () => {
            this.exportAmendmentDraft('CSV');
          }
        }
      ]
    });
    await alert.present();
  }

  exportAmendmentDraft(format: 'PDF' | 'CSV'): void {
    if (!this.budget) return;
    const isEn = this.app.currentLanguage === 'en';

    const options: AmendmentDraftExportOptions = {
      language: isEn ? 'en' : 'pl',
      organisationNamePl: this.app.getBudgetOrganisation('pl'),
      organisationNameEn: this.app.getBudgetOrganisation('en'),
      logoUrl: this.app.getOrganisationLogo(),
      description: this.budget.draftAmendment?.description,
      dateFormat: this.app.dateFormat,
      numberFormatMode: this.app.configurations?.financesConfig?.numberDisplayFormat || 'STANDARD'
    };

    if (format === 'PDF') {
      const html = generateAmendmentDraftHtmlReport(this.budget, this.amendmentItemsDiff, options);
      openPrintablePdf(html);
    } else {
      const csv = generateAmendmentDraftCsvContent(this.budget, this.amendmentItemsDiff, options);
      const filename = `ESN_Poland_Projekt_Nowelizacji_${this.budget.year}.csv`;
      downloadCsvFile(filename, csv);
    }
  }

  async openVersionHistoryModal(): Promise<void> {
    if (!this.budget) return;
    const modal = await this.modalCtrl.create({
      component: BudgetHistoryModalComponent,
      componentProps: {
        budget: this.budget,
        activeSnapshotId: this.activeSnapshotView?.id,
        canEdit: this.canEdit && !this.isArchived
      }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss();
    if (data?.budget) {
      this.budget = data.budget;
      this.budget.recalculateTotals();
      this.recomputeCurrentBalances();
    }
    if (data?.action === 'VIEW_SNAPSHOT' && data.snapshot) {
      this.activeSnapshotView = data.snapshot;
    }
  }

  exitSnapshotView(): void {
    this.activeSnapshotView = null;
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
  // UNBUDGETED CASH FLOWS
  // ==========================================

  showUnbudgetedDetails: boolean = false;

  get unbudgetedCashFlows(): {
    tx: BankTransactionRecord;
    unallocatedAmount: number;
    unallocatedAmountPln: number;
    type: 'REVENUE' | 'EXPENSE';
  }[] {
    if (!this.cachedTxs || !this.cachedTxs.length) return [];
    const eurRate = this.cachedCurrentNbpRate?.rate || this.budget?.openingBalances?.eurExchangeRate || 1;
    const result: {
      tx: BankTransactionRecord;
      unallocatedAmount: number;
      unallocatedAmountPln: number;
      type: 'REVENUE' | 'EXPENSE';
    }[] = [];

    for (const tx of this.cachedTxs) {
      if (tx.directBudgetLineCode || tx.directBudgetCode) continue;
      const allocated = (tx.settlements || []).reduce((acc, s) => acc + (Number(s.allocatedAmount) || 0), 0);
      const absAmount = Math.abs(tx.amount || 0);
      const remaining = Math.round((absAmount - allocated) * 100) / 100;
      if (remaining > 0.01) {
        const isRevenue = (tx.amount || 0) > 0 || tx.direction === 'INFLOW';
        const rate = (tx.currency || 'PLN').toUpperCase() === 'EUR' ? eurRate : 1;
        const remainingPln = Math.round(remaining * rate * 100) / 100;
        result.push({
          tx,
          unallocatedAmount: remaining,
          unallocatedAmountPln: remainingPln,
          type: isRevenue ? 'REVENUE' : 'EXPENSE'
        });
      }
    }

    return result.sort((a, b) => {
      const dateA = a.tx.bookingDate || a.tx.operationDate || '';
      const dateB = b.tx.bookingDate || b.tx.operationDate || '';
      return dateB.localeCompare(dateA);
    });
  }

  get unbudgetedRevenues() {
    return this.unbudgetedCashFlows.filter((f) => f.type === 'REVENUE');
  }

  get unbudgetedExpenses() {
    return this.unbudgetedCashFlows.filter((f) => f.type === 'EXPENSE');
  }

  get unbudgetedRevenueTotalPln(): number {
    return Math.round(this.unbudgetedRevenues.reduce((acc, f) => acc + f.unallocatedAmountPln, 0) * 100) / 100;
  }

  get unbudgetedExpenseTotalPln(): number {
    return Math.round(this.unbudgetedExpenses.reduce((acc, f) => acc + f.unallocatedAmountPln, 0) * 100) / 100;
  }

  get unbudgetedNetResultPln(): number {
    return Math.round((this.unbudgetedRevenueTotalPln - this.unbudgetedExpenseTotalPln) * 100) / 100;
  }

  toggleUnbudgetedDetails(): void {
    this.showUnbudgetedDetails = !this.showUnbudgetedDetails;
  }

  jumpToTransaction(txId: string): void {
    if (!this.budget) return;
    this.navService.jumpTo({
      subtab: 'TRANSACTIONS',
      targetId: txId,
      year: this.budget.year
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
    if (this.isOpeningBalancesLocked) {
      const toast = await this.toastCtrl.create({
        message: this.translate.instant('FINANCES.BUDGET.OPENING_BALANCES_LOCKED_TOOLTIP'),
        duration: 3500,
        color: 'warning'
      });
      await toast.present();
      return;
    }
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
      totalOpeningBalance: bPln + bEurInPln + dep,
      isLocked: true,
      lockedAt: new Date().toISOString(),
      lockedBy: this.app.currentUser?.userId || ''
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
