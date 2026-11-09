import { DynamoDB, HandledError, ResourceController } from 'idea-aws';
import { AppPermission, Configurations } from '../models/configurations.model';
import { User } from '../models/user.model';

const DDB_TABLES = {
  subledgers: process.env.DDB_TABLE_financial_subledgers || 'esn-poland-finances-dev-financial_subledgers',
  configurations: process.env.DDB_TABLE_configurations
};

const ddb = new DynamoDB();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new FinancialSubledgersRC(ev, cb).handleRequest();

class FinancialSubledgersRC extends ResourceController {
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
      this.user.hasPermission(AppPermission.FINANCES.PARENT);

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
    const yearParam = (this.queryParams as any)?.year || (this.pathParameters as any)?.year;
    const type = (this.pathParameters as any)?.type || (this.queryParams as any)?.type;
    const year = parseInt(yearParam, 10);

    if (year && !isNaN(year) && type) {
      const items: any[] = await ddb.query({
        TableName: DDB_TABLES.subledgers,
        IndexName: 'byYearType',
        KeyConditionExpression: '#yr = :year AND #tp = :type',
        ExpressionAttributeNames: { '#yr': 'year', '#tp': 'subledgerType' },
        ExpressionAttributeValues: { ':year': year, ':type': type }
      }).catch(() => []);
      if (items && items.length > 0) {
        items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      }
      return items || [];
    }

    if (year && !isNaN(year)) {
      const all: any[] = await ddb.scan({ TableName: DDB_TABLES.subledgers }).catch(() => []);
      const filtered = (all || []).filter((item: any) => item.year === year && (!type || item.subledgerType === type));
      filtered.sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return filtered;
    }

    const all = await ddb.scan({ TableName: DDB_TABLES.subledgers }).catch(() => []);
    all.sort((a: any, b: any) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return all || [];
  }

  protected async getResource(): Promise<any> {
    const id = (this.pathParameters as any)?.id;
    if (!id) return this.getResources();

    const item = await ddb.get({
      TableName: DDB_TABLES.subledgers,
      Key: { id }
    }).catch(() => null);

    if (!item) {
      this.returnStatusCode = 404;
      throw new HandledError('Record not found');
    }
    return item;
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
    const record = this.body;
    if (record.subledgerType === 'reconciliation' && record.year) {
      record.id = record.id || `reconciliation_${record.year}`;
    } else if (!record.id) {
      record.id = `sub_${Date.now()}`;
    }
    record.updatedAt = new Date().toISOString();

    await ddb.put({
      TableName: DDB_TABLES.subledgers,
      Item: record
    });
    return record;
  }

  protected async deleteResource(): Promise<any> {
    const id = (this.pathParameters as any)?.id;
    if (!id) {
      this.returnStatusCode = 400;
      throw new HandledError('Record ID required');
    }

    await ddb.delete({
      TableName: DDB_TABLES.subledgers,
      Key: { id }
    });
    return { success: true, deletedId: id };
  }
}
