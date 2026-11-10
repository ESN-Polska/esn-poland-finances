import { Resource } from 'idea-toolbox';

export type BudgetLineType = 'REVENUE' | 'EXPENSE';

export interface BudgetLineItem {
  id?: string;
  /** Immutable budget code (e.g. 'card', 'biuro', 'del-statutowe') */
  code: string;
  name: {
    pl: string;
    en: string;
  };
  /** Narrative explanation of this line used in Document 1 ("The proposed budget explained") */
  description?: {
    pl?: string;
    en?: string;
  };
  type?: BudgetLineType;
  /** Planned budgeted amount in PLN */
  budgetedAmount?: number;
  plannedAmount?: number;
  /** Live executed actual amount in PLN */
  actualAmount?: number;
  /** Difference: budgetedAmount - actualAmount */
  variance?: number;
  /** Execution percentage: (actualAmount / budgetedAmount) * 100 */
  executionPercentage?: number;
  amendmentsDelta?: number;
  notes?: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface DynamicBudgetGroup {
  id: string;
  code?: string;
  name: {
    pl: string;
    en: string;
  };
  displayOrder: number;
  /** Child items: can be direct budget lines or nested sub-groups */
  items: (DynamicBudgetGroup | BudgetLineItem)[];

  totalBudgeted?: number;
  totalPlanned?: number;
  subtotalPlanned?: number;
  totalActual?: number;
  subtotalActual?: number;
  executionPercentage?: number;
}

export interface CategorySection {
  enabled: boolean;
  type: BudgetLineType;
  /** Ordered list of direct lines and groups within this section */
  items: (DynamicBudgetGroup | BudgetLineItem)[];
  totalPlanned?: number;
  totalActual?: number;
  executionPercentage?: number;
}

export interface DynamicBudgetCategory {
  id: string;
  number: number; // 1, 2, 3...
  name: {
    pl: string;
    en: string;
  };
  displayOrder: number;

  /** Revenues section (always rendered above expenses if enabled/present) */
  revenues?: CategorySection;
  /** Expenses section */
  expenses?: CategorySection;

  /** Category result narrative explanation for official PDF exports */
  categoryResultExplanation?: {
    pl?: string;
    en?: string;
  };

  // Category-level individual totals
  totalPlannedRevenue?: number;
  totalActualRevenue?: number;
  totalPlannedExpense?: number;
  totalActualExpense?: number;

  // Individual category result (Revenues - Expenses)
  plannedNetResult?: number;
  actualNetResult?: number;
  executionPercentage?: number;
}

export function isBudgetGroup(item: any): item is DynamicBudgetGroup {
  return item && typeof item === 'object' && Array.isArray((item as DynamicBudgetGroup).items);
}

export function isBudgetLine(item: any): item is BudgetLineItem {
  return item && typeof item === 'object' && typeof (item as BudgetLineItem).code === 'string' && !Array.isArray((item as any).items);
}

export interface OpeningBalances {
  /** PLN account balance on 01.01 */
  bankPlnStartingBalance?: number;
  /** EUR account balance on 01.01 */
  bankEurStartingBalance?: number;
  /** Starting funds held in trust for local section sub-accounts on 01.01 */
  sectionReservesStartingBalance?: number;
  /** Term deposits / investment funds on 01.01 */
  termDepositsStartingBalance?: number;
  /** Operational surplus unspent from the previous closed year */
  unspentOperatingSurplusCarryover?: number;
  notes?: string;

  // UI convenience aliases
  bankPln?: number;
  bankEurInPln?: number;
  termDepositsPln?: number;
  cashDeskPln?: number;
  totalOpeningBalance?: number;
  eurExchangeRate?: number;
  eurExchangeDate?: string;
}

export type BudgetAmendmentType = 'ADD_LINE' | 'MODIFY_LINE' | 'REMOVE_LINE' | 'RENAME_LINE';

export interface BudgetAmendmentItem {
  lineId: string;
  /** Code of the budget line - strictly immutable */
  budgetCode: string;
  lineName: {
    pl: string;
    en: string;
  };
  oldLineName?: {
    pl: string;
    en: string;
  };
  newLineName?: {
    pl: string;
    en: string;
  };
  type: BudgetLineType;
  changeType: BudgetAmendmentType;
  currentAmount: number;
  proposedAmount: number;
  /** delta = proposedAmount - currentAmount */
  deltaAmount: number;
  actualAmountAtTime?: number;
  /** Mandatory justification for the amendment */
  explanation: string;

  // UI convenience aliases
  lineCode?: string;
  previousAmount?: number;
  newAmount?: number;
  difference?: number;
  justification?: string;
  categoryPath?: string;
}

export interface BudgetAmendment {
  id: string;
  amendmentNumber: string; // e.g. "1/2026"
  /** Resolution number from the National Assembly (e.g. "Uchwała nr 04/NA-Warszawa/2026") */
  resolutionNumber?: string;
  /** Meeting code associated with the amendment (e.g. "NA1") */
  assemblyMeetingCode?: string;
  date: string;
  adoptedDate?: string;
  description?: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  items: BudgetAmendmentItem[];
  totalRevenueDelta: number;
  totalExpenseDelta: number;
  netBudgetDelta: number;
  summaryNarrative?: string;
  approvedAt?: string;
  approvedBy?: string;
  createdAt?: string;
}

export interface BudgetVersionSnapshot {
  id: string;
  resolutionNumber: string;
  adoptedDate: string;
  title?: string;
  type: 'INITIAL_ADOPTION' | 'AMENDMENT';
  description?: string;
  createdAt: string;
  createdBy?: string;
  amendmentId?: string;
  totalRevenue: number;
  totalExpense: number;
  netResult: number;
  categories: DynamicBudgetCategory[];
}

export interface BudgetAmendmentDraft {
  id: string;
  updatedAt: string;
  updatedBy?: string;
  resolutionNumber?: string;
  adoptedDate?: string;
  description?: string;
  draftCategories: DynamicBudgetCategory[];
  itemsDiff: BudgetAmendmentItem[];
  totalRevenueDelta: number;
  totalExpenseDelta: number;
  netBudgetDelta: number;
}

export type AnnualBudgetStatus = 'DRAFT' | 'ADOPTED' | 'AMENDED' | 'ARCHIVED';

export class AnnualBudget extends Resource {
  year: number;
  title: {
    pl: string;
    en: string;
  };
  status: AnnualBudgetStatus;
  resolutionNumber?: string;
  adoptedDate?: string;
  categories: DynamicBudgetCategory[];
  openingBalances: OpeningBalances;
  amendments: BudgetAmendment[];
  versionHistory: BudgetVersionSnapshot[];
  draftAmendment?: BudgetAmendmentDraft | null;
  currency: 'PLN';

  // Calculated high-level totals
  totalBudgetedRevenue: number;
  totalBudgetedExpense: number;
  budgetedNetResult: number;

  totalActualRevenue: number;
  totalActualExpense: number;
  actualNetResult: number;

  get totalPlannedRevenue(): number {
    return this.totalBudgetedRevenue;
  }
  set totalPlannedRevenue(v: number) {
    this.totalBudgetedRevenue = v;
  }

  get totalPlannedExpenses(): number {
    return this.totalBudgetedExpense;
  }
  set totalPlannedExpenses(v: number) {
    this.totalBudgetedExpense = v;
  }

  get totalActualExpenses(): number {
    return this.totalActualExpense;
  }
  set totalActualExpenses(v: number) {
    this.totalActualExpense = v;
  }

  get plannedNetResult(): number {
    return this.budgetedNetResult;
  }
  set plannedNetResult(v: number) {
    this.budgetedNetResult = v;
  }

  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;

  constructor(data?: any) {
    super();
    if (data) {
      this.load(data);
    }
  }

  private loadNode(
    it: any,
    defaultType: BudgetLineType,
    cIdx: number,
    pIdx: string,
    idx: number
  ): DynamicBudgetGroup | BudgetLineItem {
    const isExplicitGroup = Array.isArray(it.items) || it.kind === 'GROUP';

    if (isExplicitGroup) {
      const rawChildren = it.items || [];
      const children = rawChildren.map((child: any, chIdx: number) =>
        this.loadNode(child, defaultType, cIdx, `${pIdx}_${idx}`, chIdx)
      );

      const grp: DynamicBudgetGroup = {
        id: this.clean(it.id, String, `grp_${cIdx + 1}_${pIdx}_${idx + 1}`),
        code: this.clean(it.code, String, ''),
        name: {
          pl: this.clean(it.name?.pl, String, ''),
          en: this.clean(it.name?.en, String, '')
        },
        displayOrder: this.clean(it.displayOrder, Number, idx),
        items: children
      };
      return grp;
    } else {
      const ln: BudgetLineItem = {
        id: this.clean(it.id, String, `line_${cIdx + 1}_${pIdx}_${idx + 1}`),
        code: this.clean(it.code, String, '').trim(),
        name: {
          pl: this.clean(it.name?.pl, String, ''),
          en: this.clean(it.name?.en, String, '')
        },
        description: {
          pl: this.clean(it.description?.pl, String, ''),
          en: this.clean(it.description?.en, String, '')
        },
        type: (it.type === 'REVENUE' || it.type === 'EXPENSE' ? it.type : defaultType) as BudgetLineType,
        budgetedAmount: this.clean(it.budgetedAmount ?? it.plannedAmount, Number, 0),
        plannedAmount: this.clean(it.plannedAmount ?? it.budgetedAmount, Number, 0),
        actualAmount: this.clean(it.actualAmount, Number, 0),
        amendmentsDelta: this.clean(it.amendmentsDelta, Number, 0),
        notes: this.clean(it.notes, String, ''),
        displayOrder: this.clean(it.displayOrder, Number, idx),
        isActive: it.isActive !== false
      };
      return ln;
    }
  }

  load(x: any): void {
    super.load(x);
    this.year = this.clean(x.year, Number, new Date().getFullYear());
    this.title = {
      pl: this.clean(x.title?.pl, String, `Budżet ESN Polska ${this.year}`),
      en: this.clean(x.title?.en, String, `ESN Poland Annual Budget ${this.year}`)
    };
    this.status = this.clean(x.status, String, 'DRAFT') as AnnualBudgetStatus;
    this.resolutionNumber = this.clean(x.resolutionNumber, String, '');
    this.adoptedDate = this.clean(x.adoptedDate, String, '');
    this.currency = 'PLN';

    this.categories = Array.isArray(x.categories)
      ? x.categories.map((cat: any, cIdx: number) => {
          const catId = this.clean(cat.id, String, `cat_${cIdx + 1}`);
          const catNumber = this.clean(cat.number, Number, cIdx + 1);
          const displayOrder = this.clean(cat.displayOrder, Number, cIdx);

          let revenuesSection: CategorySection | undefined;
          let expensesSection: CategorySection | undefined;

          if (cat.revenues) {
            const rawItems = Array.isArray(cat.revenues.items) ? cat.revenues.items : [];
            revenuesSection = {
              enabled: cat.revenues.enabled !== false,
              type: 'REVENUE',
              items: rawItems.map((it: any, itIdx: number) => this.loadNode(it, 'REVENUE', cIdx, 'rev', itIdx))
            };
          }

          if (cat.expenses) {
            const rawItems = Array.isArray(cat.expenses.items) ? cat.expenses.items : [];
            expensesSection = {
              enabled: cat.expenses.enabled !== false,
              type: 'EXPENSE',
              items: rawItems.map((it: any, itIdx: number) => this.loadNode(it, 'EXPENSE', cIdx, 'exp', itIdx))
            };
          }

          const parsedCat: DynamicBudgetCategory = {
            id: catId,
            number: catNumber,
            name: {
              pl: this.clean(cat.name?.pl, String, ''),
              en: this.clean(cat.name?.en, String, '')
            },
            displayOrder,
            categoryResultExplanation: {
              pl: typeof cat.categoryResultExplanation === 'string'
                ? cat.categoryResultExplanation
                : this.clean(cat.categoryResultExplanation?.pl, String, ''),
              en: typeof cat.categoryResultExplanation === 'object'
                ? this.clean(cat.categoryResultExplanation?.en, String, '')
                : ''
            },
            revenues: revenuesSection,
            expenses: expensesSection
          };

          return parsedCat;
        })
      : [];

    this.openingBalances = {
      bankPlnStartingBalance: this.clean(x.openingBalances?.bankPlnStartingBalance || x.openingBalances?.bankPln, Number, 0),
      bankEurStartingBalance: this.clean(x.openingBalances?.bankEurStartingBalance, Number, 0),
      sectionReservesStartingBalance: this.clean(x.openingBalances?.sectionReservesStartingBalance, Number, 0),
      termDepositsStartingBalance: this.clean(x.openingBalances?.termDepositsStartingBalance || x.openingBalances?.termDepositsPln, Number, 0),
      unspentOperatingSurplusCarryover: this.clean(x.openingBalances?.unspentOperatingSurplusCarryover, Number, 0),
      notes: this.clean(x.openingBalances?.notes, String, ''),
      bankPln: this.clean(x.openingBalances?.bankPln || x.openingBalances?.bankPlnStartingBalance, Number, 0),
      bankEurInPln: this.clean(x.openingBalances?.bankEurInPln, Number, 0),
      termDepositsPln: this.clean(x.openingBalances?.termDepositsPln || x.openingBalances?.termDepositsStartingBalance, Number, 0),
      cashDeskPln: this.clean(x.openingBalances?.cashDeskPln, Number, 0),
      totalOpeningBalance: this.clean(x.openingBalances?.totalOpeningBalance, Number, 0),
      eurExchangeRate: this.clean(x.openingBalances?.eurExchangeRate, Number, 0),
      eurExchangeDate: this.clean(x.openingBalances?.eurExchangeDate, String, '')
    };

    this.amendments = Array.isArray(x.amendments)
      ? x.amendments.map((am: any) => ({
          id: this.clean(am.id, String),
          amendmentNumber: this.clean(am.amendmentNumber, String),
          resolutionNumber: this.clean(am.resolutionNumber, String, ''),
          assemblyMeetingCode: this.clean(am.assemblyMeetingCode, String, ''),
          date: this.clean(am.date, String, new Date().toISOString().substring(0, 10)),
          status: this.clean(am.status, String, 'DRAFT') as 'DRAFT' | 'APPROVED' | 'REJECTED',
          items: Array.isArray(am.items)
            ? am.items.map((it: any) => ({
                lineId: this.clean(it.lineId, String),
                budgetCode: this.clean(it.budgetCode, String),
                lineName: {
                  pl: this.clean(it.lineName?.pl, String, ''),
                  en: this.clean(it.lineName?.en, String, '')
                },
                type: (it.type === 'REVENUE' ? 'REVENUE' : 'EXPENSE') as BudgetLineType,
                changeType: this.clean(it.changeType, String, 'MODIFY_LINE') as BudgetAmendmentType,
                currentAmount: this.clean(it.currentAmount, Number, 0),
                proposedAmount: this.clean(it.proposedAmount, Number, 0),
                deltaAmount: this.clean(it.deltaAmount, Number, 0),
                explanation: this.clean(it.explanation, String, '')
              }))
            : [],
          totalRevenueDelta: this.clean(am.totalRevenueDelta, Number, 0),
          totalExpenseDelta: this.clean(am.totalExpenseDelta, Number, 0),
          netBudgetDelta: this.clean(am.netBudgetDelta, Number, 0),
          summaryNarrative: this.clean(am.summaryNarrative, String, ''),
          approvedAt: this.clean(am.approvedAt, String, ''),
          approvedBy: this.clean(am.approvedBy, String, '')
        }))
      : [];

    this.versionHistory = Array.isArray(x.versionHistory)
      ? x.versionHistory.map((v: any) => ({
          id: this.clean(v.id, String),
          resolutionNumber: this.clean(v.resolutionNumber, String, ''),
          adoptedDate: this.clean(v.adoptedDate, String, ''),
          title: this.clean(v.title, String, ''),
          type: (v.type === 'INITIAL_ADOPTION' ? 'INITIAL_ADOPTION' : 'AMENDMENT') as 'INITIAL_ADOPTION' | 'AMENDMENT',
          description: this.clean(v.description, String, ''),
          createdAt: this.clean(v.createdAt, String, new Date().toISOString()),
          createdBy: this.clean(v.createdBy, String, ''),
          amendmentId: this.clean(v.amendmentId, String, ''),
          totalRevenue: this.clean(v.totalRevenue, Number, 0),
          totalExpense: this.clean(v.totalExpense, Number, 0),
          netResult: this.clean(v.netResult, Number, 0),
          categories: Array.isArray(v.categories) ? v.categories : []
        }))
      : [];

    this.draftAmendment = x.draftAmendment && typeof x.draftAmendment === 'object'
      ? {
          id: this.clean(x.draftAmendment.id, String),
          updatedAt: this.clean(x.draftAmendment.updatedAt, String, new Date().toISOString()),
          updatedBy: this.clean(x.draftAmendment.updatedBy, String, ''),
          resolutionNumber: this.clean(x.draftAmendment.resolutionNumber, String, ''),
          adoptedDate: this.clean(x.draftAmendment.adoptedDate, String, ''),
          description: this.clean(x.draftAmendment.description, String, ''),
          draftCategories: Array.isArray(x.draftAmendment.draftCategories) ? x.draftAmendment.draftCategories : [],
          itemsDiff: Array.isArray(x.draftAmendment.itemsDiff) ? x.draftAmendment.itemsDiff : [],
          totalRevenueDelta: this.clean(x.draftAmendment.totalRevenueDelta, Number, 0),
          totalExpenseDelta: this.clean(x.draftAmendment.totalExpenseDelta, Number, 0),
          netBudgetDelta: this.clean(x.draftAmendment.netBudgetDelta, Number, 0)
        }
      : null;

    this.createdAt = this.clean(x.createdAt, String, new Date().toISOString());
    this.updatedAt = this.clean(x.updatedAt, String, new Date().toISOString());
    this.createdBy = this.clean(x.createdBy, String, '');
    this.updatedBy = this.clean(x.updatedBy, String, '');

    this.recalculateTotals();
  }

  /**
   * Recursively recalculates totals for a node (group or line)
   */
  private recalculateNodeTotals(node: DynamicBudgetGroup | BudgetLineItem): { planned: number; actual: number } {
    if (isBudgetLine(node)) {
      if (node.isActive === false) return { planned: 0, actual: 0 };
      const baseBudgeted = Number(node.budgetedAmount ?? node.plannedAmount) || 0;
      const delta = Number(node.amendmentsDelta) || 0;
      const activePlanned = baseBudgeted + delta;
      const actual = Number(node.actualAmount) || 0;

      node.budgetedAmount = baseBudgeted;
      node.amendmentsDelta = delta;
      node.plannedAmount = activePlanned;
      node.actualAmount = actual;
      node.variance = activePlanned - actual;
      node.executionPercentage = activePlanned !== 0 ? Math.round((actual / activePlanned) * 10000) / 100 : 0;

      return { planned: activePlanned, actual };
    } else if (isBudgetGroup(node)) {
      let grpPlanned = 0;
      let grpActual = 0;

      for (const child of node.items || []) {
        const res = this.recalculateNodeTotals(child);
        grpPlanned += res.planned;
        grpActual += res.actual;
      }

      node.subtotalPlanned = grpPlanned;
      node.totalPlanned = grpPlanned;
      node.totalBudgeted = grpPlanned;
      node.subtotalActual = grpActual;
      node.totalActual = grpActual;
      node.executionPercentage = grpPlanned !== 0 ? Math.round((grpActual / grpPlanned) * 10000) / 100 : 0;

      return { planned: grpPlanned, actual: grpActual };
    }
    return { planned: 0, actual: 0 };
  }

  /**
   * Recalculates all section, category, and budget totals, variances, and percentages
   */
  recalculateTotals(): void {
    let revBudget = 0;
    let revActual = 0;
    let expBudget = 0;
    let expActual = 0;

    for (let cIdx = 0; cIdx < (this.categories || []).length; cIdx++) {
      const cat = this.categories[cIdx];
      cat.number = cIdx + 1;
      cat.displayOrder = cIdx;

      let catRevPlanned = 0;
      let catRevActual = 0;
      let catExpPlanned = 0;
      let catExpActual = 0;

      // 1. Process Revenues Section
      if (cat.revenues && cat.revenues.enabled !== false) {
        let secPlanned = 0;
        let secActual = 0;
        for (const item of cat.revenues.items || []) {
          const res = this.recalculateNodeTotals(item);
          secPlanned += res.planned;
          secActual += res.actual;
        }
        cat.revenues.totalPlanned = secPlanned;
        cat.revenues.totalActual = secActual;
        cat.revenues.executionPercentage =
          secPlanned !== 0 ? Math.round((secActual / secPlanned) * 10000) / 100 : 0;

        catRevPlanned = secPlanned;
        catRevActual = secActual;
      }

      // 2. Process Expenses Section
      if (cat.expenses && cat.expenses.enabled !== false) {
        let secPlanned = 0;
        let secActual = 0;
        for (const item of cat.expenses.items || []) {
          const res = this.recalculateNodeTotals(item);
          secPlanned += res.planned;
          secActual += res.actual;
        }
        cat.expenses.totalPlanned = secPlanned;
        cat.expenses.totalActual = secActual;
        cat.expenses.executionPercentage =
          secPlanned !== 0 ? Math.round((secActual / secPlanned) * 10000) / 100 : 0;

        catExpPlanned = secPlanned;
        catExpActual = secActual;
      }

      // 3. Category Individual Results
      cat.totalPlannedRevenue = catRevPlanned;
      cat.totalActualRevenue = catRevActual;
      cat.totalPlannedExpense = catExpPlanned;
      cat.totalActualExpense = catExpActual;

      cat.plannedNetResult = catRevPlanned - catExpPlanned;
      cat.actualNetResult = catRevActual - catExpActual;
      cat.executionPercentage =
        cat.plannedNetResult !== 0
          ? Math.round((cat.actualNetResult / cat.plannedNetResult) * 10000) / 100
          : undefined;

      revBudget += catRevPlanned;
      revActual += catRevActual;
      expBudget += catExpPlanned;
      expActual += catExpActual;
    }

    this.totalBudgetedRevenue = revBudget;
    this.totalBudgetedExpense = expBudget;
    this.budgetedNetResult = revBudget - expBudget;

    this.totalActualRevenue = revActual;
    this.totalActualExpense = expActual;
    this.actualNetResult = revActual - expActual;
  }

  /**
   * Flattened list of all active budget lines across all categories, sections, groups, and sub-groups
   */
  getAllLines(): BudgetLineItem[] {
    const list: BudgetLineItem[] = [];

    const collectLines = (items: (DynamicBudgetGroup | BudgetLineItem)[]) => {
      for (const it of items || []) {
        if (isBudgetLine(it)) {
          list.push(it);
        } else if (isBudgetGroup(it)) {
          collectLines(it.items || []);
        }
      }
    };

    for (const cat of this.categories || []) {
      if (cat.revenues?.items) {
        collectLines(cat.revenues.items);
      }
      if (cat.expenses?.items) {
        collectLines(cat.expenses.items);
      }
    }

    const seen = new Set<string>();
    return list.filter((l) => {
      if (!l.code || seen.has(l.code)) return false;
      seen.add(l.code);
      return true;
    });
  }

  /**
   * Find a budget line by its immutable budget code (e.g. 'card')
   */
  findLineByCode(code: string): BudgetLineItem | undefined {
    const norm = String(code || '').toLowerCase().trim();
    if (!norm) return undefined;
    return this.getAllLines().find((ln) => ln.code.toLowerCase().trim() === norm);
  }

  /**
   * Creates an immutable snapshot of the budget state tied to a resolution
   */
  createSnapshot(
    type: 'INITIAL_ADOPTION' | 'AMENDMENT',
    resolutionNumber: string,
    adoptedDate: string,
    title?: string,
    description?: string,
    amendmentId?: string,
    user?: string
  ): BudgetVersionSnapshot {
    this.recalculateTotals();
    const snapshot: BudgetVersionSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      resolutionNumber: (resolutionNumber || '').trim(),
      adoptedDate: adoptedDate || new Date().toISOString().substring(0, 10),
      title: title || (type === 'INITIAL_ADOPTION' ? 'Uchwalenie budżetu pierwotnego' : `Nowelizacja (${(resolutionNumber || '').trim()})`),
      type,
      description: description || '',
      createdAt: new Date().toISOString(),
      createdBy: user || '',
      amendmentId: amendmentId || '',
      totalRevenue: this.totalBudgetedRevenue,
      totalExpense: this.totalBudgetedExpense,
      netResult: this.budgetedNetResult,
      categories: JSON.parse(JSON.stringify(this.categories || []))
    };

    if (!Array.isArray(this.versionHistory)) {
      this.versionHistory = [];
    }
    this.versionHistory.push(snapshot);
    return snapshot;
  }

  /**
   * Applies an approved amendment, updates categories and deltas, records a version snapshot,
   * updates status to AMENDED and clears active draft.
   */
  applyAmendment(
    amendment: BudgetAmendment,
    updatedCategories?: DynamicBudgetCategory[],
    user?: string
  ): void {
    if (updatedCategories && Array.isArray(updatedCategories) && updatedCategories.length > 0) {
      this.categories = updatedCategories;
    } else {
      for (const item of amendment.items || []) {
        const line = this.findLineByCode(item.budgetCode || item.lineCode || '');
        if (line) {
          line.amendmentsDelta = (line.amendmentsDelta || 0) + (item.deltaAmount || 0);
          line.plannedAmount = (line.budgetedAmount || 0) + line.amendmentsDelta;
          if (item.newLineName?.pl) line.name.pl = item.newLineName.pl;
          if (item.newLineName?.en) line.name.en = item.newLineName.en;
        }
      }
    }

    this.status = 'AMENDED';
    this.amendments = this.amendments || [];
    this.amendments.push(amendment);
    this.draftAmendment = null;
    this.recalculateTotals();

    this.createSnapshot(
      'AMENDMENT',
      amendment.resolutionNumber || '',
      amendment.adoptedDate || amendment.date || '',
      `Nowelizacja: ${amendment.resolutionNumber || amendment.amendmentNumber}`,
      amendment.description || '',
      amendment.id,
      user
    );
  }

  validate(): string[] {
    const errors: string[] = [];
    if (!this.year || this.year < 2000 || this.year > 2100) {
      errors.push('Invalid fiscal year');
    }

    // Check duplicate line codes
    const seenCodes = new Set<string>();
    for (const ln of this.getAllLines()) {
      const code = ln.code.toLowerCase().trim();
      if (!code) {
        errors.push(`Budget line "${ln.name.pl || ln.name.en || ln.id}" must have a non-empty code.`);
      } else if (seenCodes.has(code)) {
        errors.push(`Duplicate budget line code found: "${code}". Each budget code must be globally unique.`);
      } else {
        seenCodes.add(code);
      }
    }

    return errors;
  }
}

function catExpExpOrZero(val: number): number {
  return typeof val === 'number' && !isNaN(val) ? val : 0;
}
