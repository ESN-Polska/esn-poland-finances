import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { AnnualBudget } from '../models/annual-budget.model';
import { AppPermission, Configurations } from '../models/configurations.model';
import { User } from '../models/user.model';

const DDB_TABLES = {
  budgets: process.env.DDB_TABLE_annual_budgets || 'esn-poland-finances-dev-annual_budgets',
  configurations: process.env.DDB_TABLE_configurations
};

const ddb = new DynamoDB();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new BudgetsRC(ev, cb).handleRequest();

class BudgetsRC extends ResourceController {
  user: User | null = null;
  configurations!: Configurations;

  constructor(event: any, callback: any) {
    super(event, callback, { resourceId: 'year' });
  }

  private getAuthenticatedUser(): User {
    const userRaw = (this.event as any)?.requestContext?.authorizer?.lambda?.user || (this.event as any)?.user;
    if (!userRaw) {
      this.returnStatusCode = 401;
      throw new HandledError('Unauthorized');
    }
    return new User(userRaw);
  }

  private getYearParam(): number {
    const raw = (this.pathParameters as any)?.year || (this.queryParams as any)?.year;
    const yr = parseInt(raw, 10);
    return isNaN(yr) ? new Date().getFullYear() : yr;
  }

  protected async checkAuthBeforeRequest(): Promise<void> {
    this.user = this.getAuthenticatedUser();

    if (DDB_TABLES.configurations) {
      const configsData = await ddb.get({
        TableName: DDB_TABLES.configurations,
        Key: { PK: Configurations.PK }
      }).catch(() => null);
      this.configurations = new Configurations(configsData || {});
      User.applyConfigurationPermissions(this.user, this.configurations);
    } else {
      this.configurations = new Configurations();
    }

    const httpMethod = (this.event as any)?.httpMethod || (this.event as any)?.requestContext?.httpMethod || 'GET';
    const isReadMethod = httpMethod === 'GET';

    const canView =
      this.user.isAdministrator ||
      this.user.isManager ||
      this.user.isAuditor ||
      this.user.hasPermission(AppPermission.FINANCES.PARENT) ||
      this.user.hasPermission(AppPermission.FINANCES.BUDGET);

    if (!canView) {
      this.returnStatusCode = 403;
      throw new HandledError('Forbidden - insufficient finances permissions');
    }

    if (!isReadMethod) {
      const canEdit =
        this.user.isAdministrator ||
        this.user.isManager ||
        this.user.hasPermission(AppPermission.FINANCES.MANAGE) ||
        this.user.hasPermission(AppPermission.FINANCES.PARENT);

      if (!canEdit) {
        this.returnStatusCode = 403;
        throw new HandledError('Forbidden - write access required to modify budget');
      }
    }
  }

  protected async getResources(): Promise<any> {
    const items: any[] = await ddb.scan({
      TableName: DDB_TABLES.budgets
    }).catch(() => []);

    return (items || []).map((b: any) => new AnnualBudget(b));
  }

  protected async getResource(): Promise<any> {
    const year = this.getYearParam();

    const item = await ddb.get({
      TableName: DDB_TABLES.budgets,
      Key: { year }
    }).catch(() => null);

    if (item) {
      const budget = new AnnualBudget(item);
      budget.recalculateTotals();
      return budget;
    }

    this.returnStatusCode = 404;
    throw new HandledError(`Budget for year ${year} not found`);
  }

  protected async putResource(): Promise<any> {
    const year = this.getYearParam();

    const budget = new AnnualBudget(this.body);
    budget.year = year;
    budget.updatedAt = new Date().toISOString();
    budget.updatedBy = this.user?.userId || '';

    const errors = budget.validate();
    if (errors.length > 0) {
      this.returnStatusCode = 400;
      throw new HandledError(`Budget validation failed: ${errors.join('; ')}`);
    }

    budget.recalculateTotals();
    await ddb.put({
      TableName: DDB_TABLES.budgets,
      Item: budget
    });
    return budget;
  }

  protected async postResources(): Promise<any> {
    return this.postResource();
  }

  protected async putResources(): Promise<any> {
    return this.putResource();
  }

  protected async postResource(): Promise<any> {
    const rawPath = (this.event as any)?.rawPath || (this.event as any)?.path || '';
    if (rawPath.endsWith('/amendments')) {
      const year = this.getYearParam();
      const budgetData = await ddb.get({
        TableName: DDB_TABLES.budgets,
        Key: { year }
      }).catch(() => null);

      if (!budgetData) {
        this.returnStatusCode = 404;
        throw new HandledError(`Budget for year ${year} not found`);
      }

      const budget = new AnnualBudget(budgetData);
      const newAmendment = this.body;
      if (!newAmendment.resolutionNumber || !Array.isArray(newAmendment.items) || newAmendment.items.length === 0) {
        this.returnStatusCode = 400;
        throw new HandledError('Amendment must contain a resolution number and at least one item');
      }

      budget.amendments.push(newAmendment);
      budget.updatedAt = new Date().toISOString();
      budget.updatedBy = this.user?.userId || '';
      budget.recalculateTotals();

      await ddb.put({
        TableName: DDB_TABLES.budgets,
        Item: budget
      });
      return budget;
    }

    if (rawPath.endsWith('/export')) {
      const year = this.getYearParam();
      const options = this.body || {};
      const item = await ddb.get({
        TableName: DDB_TABLES.budgets,
        Key: { year }
      }).catch(() => null);

      if (!item) {
        this.returnStatusCode = 404;
        throw new HandledError(`Budget for year ${year} not found`);
      }

      const budget = new AnnualBudget(item);
      const csvContent = this.generateBudgetCsv(budget, options);
      const filename = `budzet_${year}_${(options.type || 'wykonanie').toLowerCase()}.csv`;

      return {
        success: true,
        year,
        options,
        filename,
        csvContent,
        downloadUrl: null
      };
    }

    return this.putResource();
  }

  private generateBudgetCsv(budget: AnnualBudget, options: any): string {
    const yr = budget.year;
    const delim = ';';
    const lines: string[] = [];
    const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""').replace(/[\\r\\n]+/g, ' ')}"`;
    const formatNum = (num: any) => ((num || 0) as number).toFixed(2).replace('.', ',');
    const isExecution = options?.type === 'EXECUTION';
    const orgPl = this.configurations?.getBudgetOrganisation('pl') || 'ESN Polska';

    if (isExecution) {
      lines.push(escapeCsv(`RAPORT Z WYKONANIA BUDŻETU ${orgPl.toUpperCase()} NA ROK ${yr}`));
      lines.push(escapeCsv(`Status: ${budget.status || 'DRAFT'}`));
      if (budget.resolutionNumber) {
        let dateClause = '';
        if (budget.adoptedDate) {
          const parts = budget.adoptedDate.split('-');
          dateClause = parts.length === 3 && parts[0].length === 4 ? ` z dnia ${parts[2]}.${parts[1]}.${parts[0]}` : ` z dnia ${budget.adoptedDate}`;
        }
        lines.push(escapeCsv(`Uchwała WZD ${budget.resolutionNumber}${dateClause}`));
      }
      if (options.asOfDate) {
        lines.push(escapeCsv(`Stan na dzień: ${options.asOfDate}`));
      }
      lines.push('');

      lines.push([
        escapeCsv('Kategoria'),
        escapeCsv('Typ'),
        escapeCsv('Grupa'),
        escapeCsv('Kod'),
        escapeCsv('Nazwa pozycji (PL)'),
        escapeCsv('Zabudżetowano [PLN]'),
        escapeCsv('Wykonanie [PLN]'),
        escapeCsv('Odchylenie [PLN]')
      ].join(delim));

      const processItems = (items: any[], catNum: number, catName: string, secType: string, groupPath: string) => {
        for (const it of items || []) {
          if ('code' in it && !Array.isArray(it.items)) {
            const budgeted = it.budgetedAmount || it.plannedAmount || 0;
            const actual = it.actualAmount || 0;
            lines.push([
              escapeCsv(`${catNum}. ${catName}`),
              escapeCsv(secType),
              escapeCsv(groupPath),
              escapeCsv(it.code || ''),
              escapeCsv(it.name?.pl || it.name?.en || ''),
              formatNum(budgeted),
              formatNum(actual),
              formatNum(actual - budgeted)
            ].join(delim));
          } else if (Array.isArray(it.items) || Array.isArray(it.lines)) {
            const grpLabel = it.name?.pl || it.name?.en || '';
            const currentPath = groupPath ? `${groupPath} > ${grpLabel}` : grpLabel;
            processItems(it.items || it.lines || [], catNum, catName, secType, currentPath);
          }
        }
      };

      for (let cIdx = 0; cIdx < (budget.categories || []).length; cIdx++) {
        const cat = budget.categories[cIdx];
        const catNum = cat.number || cIdx + 1;
        const catName = cat.name?.pl || cat.name?.en || `Kategoria ${catNum}`;

        if (cat.revenues && cat.revenues.enabled !== false && Array.isArray(cat.revenues.items)) {
          processItems(cat.revenues.items, catNum, catName, 'Przychody', '');
        }
        if (cat.expenses && cat.expenses.enabled !== false && Array.isArray(cat.expenses.items)) {
          processItems(cat.expenses.items, catNum, catName, 'Koszty', '');
        }

        // Category Subtotal row
        const catRev = cat.totalPlannedRevenue || 0;
        const catExp = cat.totalPlannedExpense || 0;
        const catNetPlan = cat.plannedNetResult ?? (catRev - catExp);
        const catActRev = cat.totalActualRevenue || 0;
        const catActExp = cat.totalActualExpense || 0;
        const catNetAct = cat.actualNetResult ?? (catActRev - catActExp);

        lines.push([
          escapeCsv(`WYNIK: ${catNum}. ${catName}`),
          escapeCsv('Wynik'),
          '', '', '',
          formatNum(catNetPlan),
          formatNum(catNetAct),
          formatNum(catNetAct - catNetPlan)
        ].join(delim));
      }
    } else {
      lines.push(escapeCsv(`PLAN BUDŻETU ${orgPl.toUpperCase()} NA ROK ${yr}`));
      lines.push(escapeCsv(`Status: ${budget.status || 'DRAFT'}`));
      if (budget.resolutionNumber) {
        let dateClause = '';
        if (budget.adoptedDate) {
          const parts = budget.adoptedDate.split('-');
          dateClause = parts.length === 3 && parts[0].length === 4 ? ` z dnia ${parts[2]}.${parts[1]}.${parts[0]}` : ` z dnia ${budget.adoptedDate}`;
        }
        lines.push(escapeCsv(`Uchwała WZD ${budget.resolutionNumber}${dateClause}`));
      }
      lines.push('');

      lines.push([
        escapeCsv('Kategoria'),
        escapeCsv('Typ'),
        escapeCsv('Grupa'),
        escapeCsv('Kod'),
        escapeCsv('Nazwa pozycji (PL)'),
        escapeCsv('Kwota zabudżetowana [PLN]'),
        escapeCsv('Opis')
      ].join(delim));

      const processPlanItems = (items: any[], catNum: number, catName: string, secType: string, groupPath: string) => {
        for (const it of items || []) {
          if ('code' in it && !Array.isArray(it.items)) {
            const budgeted = it.budgetedAmount || it.plannedAmount || 0;
            const desc = it.description?.pl || it.description?.en || (typeof it.description === 'string' ? it.description : '');
            lines.push([
              escapeCsv(`${catNum}. ${catName}`),
              escapeCsv(secType),
              escapeCsv(groupPath),
              escapeCsv(it.code || ''),
              escapeCsv(it.name?.pl || it.name?.en || ''),
              formatNum(budgeted),
              escapeCsv(desc)
            ].join(delim));
          } else if (Array.isArray(it.items) || Array.isArray(it.lines)) {
            const grpLabel = it.name?.pl || it.name?.en || '';
            const currentPath = groupPath ? `${groupPath} > ${grpLabel}` : grpLabel;
            processPlanItems(it.items || it.lines || [], catNum, catName, secType, currentPath);
          }
        }
      };

      for (let cIdx = 0; cIdx < (budget.categories || []).length; cIdx++) {
        const cat = budget.categories[cIdx];
        const catNum = cat.number || cIdx + 1;
        const catName = cat.name?.pl || cat.name?.en || `Kategoria ${catNum}`;

        if (cat.revenues && cat.revenues.enabled !== false && Array.isArray(cat.revenues.items)) {
          processPlanItems(cat.revenues.items, catNum, catName, 'Przychody', '');
        }
        if (cat.expenses && cat.expenses.enabled !== false && Array.isArray(cat.expenses.items)) {
          processPlanItems(cat.expenses.items, catNum, catName, 'Koszty', '');
        }

        const catRev = cat.totalPlannedRevenue || 0;
        const catExp = cat.totalPlannedExpense || 0;
        const catNetPlan = cat.plannedNetResult ?? (catRev - catExp);

        lines.push([
          escapeCsv(`WYNIK: ${catNum}. ${catName}`),
          escapeCsv('Wynik'),
          '', '', '',
          formatNum(catNetPlan),
          escapeCsv(cat.categoryResultExplanation?.pl || cat.categoryResultExplanation?.en || '')
        ].join(delim));
      }
    }

    return '\uFEFF' + lines.join('\r\n');
  }
}
