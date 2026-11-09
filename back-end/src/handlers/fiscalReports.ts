import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { FiscalMonthlyReport } from '../models/fiscal-report.model';
import { AppPermission, Configurations } from '../models/configurations.model';
import { User } from '../models/user.model';

const DDB_TABLES = {
  fiscalReports: process.env.DDB_TABLE_fiscal_reports || 'esn-poland-finances-dev-fiscal_reports',
  configurations: process.env.DDB_TABLE_configurations
};

const ddb = new DynamoDB();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new FiscalReportsRC(ev, cb).handleRequest();

class FiscalReportsRC extends ResourceController {
  user: User | null = null;
  configurations!: Configurations;

  constructor(event: any, callback: any) {
    super(event, callback, { resourceId: 'id' });
  }

  private getAuthenticatedUser(): User {
    const userRaw = (this.event as any)?.requestContext?.authorizer?.lambda?.user || (this.event as any)?.user;
    if (!userRaw) {
      this.returnStatusCode = 401;
      throw new HandledError('Unauthorized');
    }
    return new User(userRaw);
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
      this.user.hasPermission(AppPermission.FINANCES.FISCAL);

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
        throw new HandledError('Forbidden - write access required');
      }
    }
  }

  protected async getResources(): Promise<any> {
    const yearParam = (this.pathParameters as any)?.year || (this.queryParams as any)?.year;
    const year = parseInt(yearParam, 10);

    if (year && !isNaN(year)) {
      const items: any[] = await ddb.query({
        TableName: DDB_TABLES.fiscalReports,
        IndexName: 'byYear',
        KeyConditionExpression: '#yr = :year',
        ExpressionAttributeNames: { '#yr': 'year' },
        ExpressionAttributeValues: { ':year': year }
      }).catch(() => []);

      if (!items || items.length === 0) {
        // Seed 12 months for this year
        const seeded: FiscalMonthlyReport[] = [];
        const monthNames = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
        for (let m = 1; m <= 12; m++) {
          const rep = new FiscalMonthlyReport({
            id: `fisc_${year}_${m}`,
            year,
            month: m,
            monthKey: `${year}-${m.toString().padStart(2, '0')}`,
            monthName: monthNames[m - 1],
            grossTotal: 0,
            vatTotal: 0,
            netTotal: 0,
            dailyReports: []
          });
          await ddb.put({
            TableName: DDB_TABLES.fiscalReports,
            Item: rep
          }).catch(() => {});
          seeded.push(rep);
        }
        return seeded;
      }

      return items.map((r: any) => new FiscalMonthlyReport(r));
    }

    const all = await ddb.scan({ TableName: DDB_TABLES.fiscalReports }).catch(() => []);
    return (all || []).map((r: any) => new FiscalMonthlyReport(r));
  }

  protected async getResource(): Promise<any> {
    const id = (this.pathParameters as any)?.id;
    if (!id) return this.getResources();

    const report = await ddb.get({
      TableName: DDB_TABLES.fiscalReports,
      Key: { id }
    }).catch(() => null);

    if (!report) {
      this.returnStatusCode = 404;
      throw new HandledError('Fiscal report not found');
    }
    return new FiscalMonthlyReport(report);
  }

  protected async postResources(): Promise<any> {
    return this.putResource();
  }

  protected async putResources(): Promise<any> {
    return this.putResource();
  }

  protected async postResource(): Promise<any> {
    return this.putResource();
  }

  protected async putResource(): Promise<any> {
    const report = new FiscalMonthlyReport(this.body);
    if (!report.id) {
      report.id = `fisc_${report.year}_${report.month}`;
    }
    report.updatedAt = new Date().toISOString();

    await ddb.put({
      TableName: DDB_TABLES.fiscalReports,
      Item: report
    });
    return report;
  }
}
